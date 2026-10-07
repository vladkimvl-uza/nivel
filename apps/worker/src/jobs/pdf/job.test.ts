import { parsePdf } from "@nivel/pdf/testkit";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import type { LinkTarget } from "./build.ts";
import type { DocFiles, LinkResult, NewFile } from "./files.ts";
import { handlePdfRender, type PdfJobDeps } from "./job.ts";
import {
  ACT_ID,
  act,
  fakeData,
  fakeRows,
  OFFER_RU,
  OFFER_UZ,
  ORDER_ID,
  quote,
  quoteLines,
  report,
} from "./test-support/rows.ts";

class MemoryFiles implements DocFiles {
  rows = new Map<string, { id: string; file: NewFile }>();
  disk = new Map<string, Buffer>();
  links: { target: LinkTarget; ids: { uz: string; ru: string } }[] = [];
  linkResult: LinkResult = "linked";
  failSaveOn: string | null = null;
  saves = 0;
  async find(key: string) {
    return this.rows.get(key)?.id ?? null;
  }
  async save(key: string, bytes: Buffer) {
    if (key === this.failSaveOn) throw new Error("disk is full");
    this.saves++;
    this.disk.set(key, bytes);
  }
  async register(file: NewFile) {
    const have = this.rows.get(file.storageKey);
    if (have) return have.id;
    const id = `file-${this.rows.size + 1}`;
    this.rows.set(file.storageKey, { id, file });
    return id;
  }
  async link(target: LinkTarget, ids: { uz: string; ru: string }) {
    this.links.push({ target, ids });
    return this.linkResult;
  }
}

const logs: { level: string; obj: unknown; msg: string }[] = [];
const record = (level: string) => (obj: unknown, msg: string) => {
  logs.push({ level, obj, msg });
};
const log = { info: record("info"), warn: record("warn"), error: record("error") } as unknown as Logger;

function deps(
  over: Partial<Parameters<typeof fakeData>[0]> = {},
  files = new MemoryFiles(),
  extra: Partial<PdfJobDeps> = {},
) {
  const rows = fakeRows(fakeData(over));
  const d: PdfJobDeps = {
    now: () => new Date("2026-10-12T05:00:00.000Z"),
    log,
    rows,
    files,
    ctx: { publicBaseUrl: "https://nivel.uz" },
    filesEnabled: true,
    ...extra,
  };
  return { d, files, rows };
}
const payload = (doc: string, more: Record<string, unknown> = {}) => ({
  job: "pdf.render",
  doc,
  orderId: ORDER_ID,
  orderNumber: "NV-2026-0001",
  ...more,
});

describe("pdf.render: the estimate", () => {
  it("renders it in both languages, registers two files under the folder of the order and links them to the quote", async () => {
    const { d, files } = deps();
    const res = await handlePdfRender(d, payload("quote"));
    expect([...files.rows.keys()].sort()).toEqual([
      "documents/NV-2026-0001/quote-2-ru.pdf",
      "documents/NV-2026-0001/quote-2-uz.pdf",
    ]);
    expect(res).toMatchObject({ doc: "quote", linked: "linked", uz: { created: true }, ru: { created: true } });
    for (const key of files.rows.keys()) {
      expect((files.disk.get(key) as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
      const reg = (files.rows.get(key) as { file: NewFile }).file;
      expect(reg).toMatchObject({ kind: "quote_pdf", retentionClass: "tax_5y", storageKey: key });
      expect(reg.bytes).toBe((files.disk.get(key) as Buffer).length);
      expect(reg.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(files.links).toEqual([
      {
        target: { table: "quotes", keyColumn: "id", key: quote().id, replace: false },
        ids: { uz: "file-1", ru: "file-2" },
      },
    ]);
  });

  it("writes the Uzbek document in Uzbek and the Russian in Russian", async () => {
    const { d, files } = deps();
    await handlePdfRender(d, payload("quote"));
    expect(parsePdf(files.disk.get("documents/NV-2026-0001/quote-2-uz.pdf") as Buffer).text).toContain("Smeta");
    expect(parsePdf(files.disk.get("documents/NV-2026-0001/quote-2-ru.pdf") as Buffer).text).toContain("Смета");
  });

  it("puts the watermark when the offer is a stub, and not when it is published: the hint of the payload is not heard", async () => {
    const clean = deps();
    await handlePdfRender(clean.d, payload("quote", { watermarkDraft: true }));
    expect(parsePdf(clean.files.disk.get("documents/NV-2026-0001/quote-2-uz.pdf") as Buffer).text).not.toContain(
      "NAMUNA / ОБРАЗЕЦ",
    );
    const stub = deps({ offers: { [OFFER_UZ]: "stub", [OFFER_RU]: "lawyer_approved" } });
    await handlePdfRender(stub.d, payload("quote", { watermarkDraft: false }));
    for (const lang of ["uz", "ru"]) {
      expect(parsePdf(stub.files.disk.get(`documents/NV-2026-0001/quote-2-${lang}.pdf`) as Buffer).text).toContain(
        "NAMUNA / ОБРАЗЕЦ",
      );
    }
  });

  it("marks the document as a sample when the data are demo", async () => {
    const { d, files } = deps({ quote: { row: quote(), lines: quoteLines({ demo: true }) } });
    await handlePdfRender(d, payload("quote"));
    expect(parsePdf(files.disk.get("documents/NV-2026-0001/quote-2-ru.pdf") as Buffer).text).toContain(
      "NAMUNA / ОБРАЗЕЦ",
    );
  });
});

describe("pdf.render: the other documents", () => {
  it("renders the report, links it to the report and keeps it for the tax term", async () => {
    const { d, files } = deps();
    await handlePdfRender(d, payload("commission_report"));
    expect([...files.rows.keys()].sort()).toEqual([
      "documents/NV-2026-0001/report-1-ru.pdf",
      "documents/NV-2026-0001/report-1-uz.pdf",
    ]);
    expect(files.links[0]?.target).toMatchObject({ table: "commission_reports", key: report().id });
    expect((files.rows.get("documents/NV-2026-0001/report-1-uz.pdf") as { file: NewFile }).file).toMatchObject({
      kind: "report_pdf",
      retentionClass: "tax_5y",
    });
  });

  it("keeps two acts of one kind made within a minute in two files, each with its own lines", async () => {
    const first = "01a115db-8370-7000-8000-000000000001";
    const second = "01a115db-f8a0-7000-8000-000000000002";
    const acts = [
      act({ id: first, signedAt: null, signedVia: null, lines: [{ title: "Old line with a slip", qty: 1 }] }),
      act({ id: second, signedAt: null, signedVia: null, lines: [{ title: "Mended line", qty: 1 }] }),
    ];
    const { d, files } = deps({ acts });
    const a = await handlePdfRender(d, payload("act_handover", { actId: first }));
    const b = await handlePdfRender(d, payload("act_handover", { actId: second }));
    expect(b.uz.created).toBe(true);
    expect(b.uz.id).not.toBe(a.uz.id);
    expect(files.rows.size).toBe(4);
    const textOf = (id: string, lang: string) =>
      parsePdf(files.disk.get(`documents/NV-2026-0001/act-handover-${id}-${lang}.pdf`) as Buffer).text;
    expect(textOf(first, "uz")).toContain("Old line with a slip");
    expect(textOf(second, "uz")).toContain("Mended line");
    expect(textOf(second, "uz")).not.toContain("Old line with a slip");
    expect(files.links.map((l) => l.target.key)).toEqual([first, second]);
  });

  it("makes the signed act a new file and moves the link to it, the unsigned one stays where it was", async () => {
    const files = new MemoryFiles();
    const open = deps({ acts: [act({ signedAt: null, signedVia: null })] }, files);
    await handlePdfRender(open.d, payload("act_handover", { actId: ACT_ID }));
    const signed = deps({ acts: [act()] }, files);
    const res = await handlePdfRender(signed.d, payload("act_handover", { actId: ACT_ID }));
    expect(res.uz.created).toBe(true);
    expect([...files.rows.keys()].sort()).toEqual([
      `documents/NV-2026-0001/act-handover-${ACT_ID}-ru.pdf`,
      `documents/NV-2026-0001/act-handover-${ACT_ID}-signed-ru.pdf`,
      `documents/NV-2026-0001/act-handover-${ACT_ID}-signed-uz.pdf`,
      `documents/NV-2026-0001/act-handover-${ACT_ID}-uz.pdf`,
    ]);
    expect(files.links.at(-1)?.target).toMatchObject({ table: "acts", replace: true });
    const text = parsePdf(files.disk.get(`documents/NV-2026-0001/act-handover-${ACT_ID}-signed-uz.pdf`) as Buffer).text;
    expect(text).not.toContain("imzolanmagan");
    expect(parsePdf(files.disk.get(`documents/NV-2026-0001/act-handover-${ACT_ID}-uz.pdf`) as Buffer).text).toContain(
      "Hali imzolanmagan",
    );
  });

  it("renders each of the three acts as its own kind of act", async () => {
    for (const [doc, kind, title] of [
      ["act_materials", "material_acceptance", "qabul qilish"],
      ["act_customer_parts", "customer_parts", "qaytarish"],
      ["act_handover", "handover", "Topshirish"],
    ] as const) {
      const { d, files } = deps({ acts: [act({ kind })] });
      await handlePdfRender(d, payload(doc, { actId: ACT_ID }));
      const uz = [...files.rows.keys()].find((k) => k.endsWith("-uz.pdf")) as string;
      expect(uz, doc).toContain("/act-");
      expect(parsePdf(files.disk.get(uz) as Buffer).text, doc).toContain(title);
      expect(files.links[0]?.target, doc).toMatchObject({ table: "acts", key: ACT_ID });
    }
  });

  it("renders the passport, linked by the order, and the warranty card, linked to nothing", async () => {
    const p = deps();
    await handlePdfRender(p.d, payload("passport"));
    expect(p.files.links[0]?.target).toMatchObject({ table: "build_passports", keyColumn: "order_id", key: ORDER_ID });
    expect(
      (p.files.rows.get("documents/NV-2026-0001/passport-handed-over-uz.pdf") as { file: NewFile }).file,
    ).toMatchObject({
      kind: "passport_pdf",
      retentionClass: "order_warranty_plus_3y",
    });
    const w = deps();
    const res = await handlePdfRender(w.d, payload("warranty"));
    expect(res.linked).toBe("none");
    expect(w.files.links).toEqual([]);
    expect([...w.files.rows.keys()].sort()).toEqual([
      "documents/NV-2026-0001/warranty-handed-over-ru.pdf",
      "documents/NV-2026-0001/warranty-handed-over-uz.pdf",
    ]);
  });
});

describe("pdf.render: a job that runs twice, or half", () => {
  it("renders nothing the second time: the files are there, the links are written once", async () => {
    const { d, files } = deps();
    await handlePdfRender(d, payload("quote"));
    const res = await handlePdfRender(d, payload("quote"));
    expect(files.saves).toBe(2);
    expect(res).toMatchObject({ uz: { created: false }, ru: { created: false }, linked: "linked" });
    expect(files.rows.size).toBe(2);
  });

  it("carries on where it stopped: the Uzbek file is kept, the Russian one is made at the next try", async () => {
    const files = new MemoryFiles();
    files.failSaveOn = "documents/NV-2026-0001/quote-2-ru.pdf";
    const { d } = deps({}, files);
    await expect(handlePdfRender(d, payload("quote"))).rejects.toThrow("disk is full");
    expect([...files.rows.keys()]).toEqual(["documents/NV-2026-0001/quote-2-uz.pdf"]);
    expect(files.links).toEqual([]);
    files.failSaveOn = null;
    const res = await handlePdfRender(d, payload("quote"));
    expect(res).toMatchObject({ uz: { created: false }, ru: { created: true } });
    expect(files.links).toHaveLength(1);
    expect(files.saves).toBe(2);
  });
});

describe("pdf.render: what it cannot do", () => {
  it("refuses for good a payload that is not a request, without touching the database", async () => {
    const { d, rows } = deps();
    await expect(handlePdfRender(d, { doc: "contract" })).rejects.toThrow(PermanentJobError);
    expect(rows.calls).toEqual([]);
  });

  it("refuses for good without FILES_DIR: there is nowhere to put a document", async () => {
    const { d, rows } = deps({}, new MemoryFiles(), { filesEnabled: false });
    await expect(handlePdfRender(d, payload("quote"))).rejects.toThrow(/FILES_DIR/);
    await expect(handlePdfRender(d, payload("quote"))).rejects.toBeInstanceOf(PermanentJobError);
    expect(rows.calls).toEqual([]);
  });

  it("lets the estimate that is still a draft, and a passport whose tests are not passed, be tried again", async () => {
    const draft = deps({ quote: { row: quote({ sentAt: null }), lines: quoteLines() } });
    const early = await handlePdfRender(draft.d, payload("quote")).catch((e) => e);
    expect(early).toBeInstanceOf(Error);
    expect(early).not.toBeInstanceOf(PermanentJobError);
    expect(draft.files.rows.size).toBe(0);
    const untested = deps({ testsPassedAt: null });
    const err = await handlePdfRender(untested.d, payload("passport")).catch((e) => e);
    expect(err).not.toBeInstanceOf(PermanentJobError);
    expect(err.message).toMatch(/not passed/);
    expect(untested.files.rows.size).toBe(0);
  });

  it("lets a document that is not there yet be tried again (the report may come a moment later)", async () => {
    const { d } = deps({ report: null });
    const err = await handlePdfRender(d, payload("commission_report")).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentJobError);
    expect(err.message).toMatch(/no report/);
  });

  it("refuses for good data that do not add up, a card in the requisites and a number that is not whole", async () => {
    const broken = deps({ quote: { row: quote({ feeFinal: quote().feeFinal + 1 }), lines: quoteLines() } });
    await expect(handlePdfRender(broken.d, payload("quote"))).rejects.toBeInstanceOf(PermanentJobError);
    expect(broken.files.rows.size).toBe(0);
    const card = deps({ settings: { "requisites.ip": { holder: "YaTT", account: "8600 1234 1234 1234" } } });
    await expect(handlePdfRender(card.d, payload("quote"))).rejects.toThrow(/card/);
    await expect(handlePdfRender(card.d, payload("quote"))).rejects.toBeInstanceOf(PermanentJobError);
    expect(card.files.rows.size).toBe(0);
    // the original error is kept as the cause, with its stack, for the log of the errors
    const failure = (await handlePdfRender(card.d, payload("quote")).catch((e: unknown) => e)) as Error;
    const cause = failure.cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).name).toBe("CardNumberError");
    expect((cause as Error).stack).toMatch(/CardNumberError/);
    const first = (report().lines as Record<string, unknown>[])[0] as Record<string, unknown>;
    const fraction = deps({ report: report({ lines: [{ ...first, amountSum: 10.5 }] }) });
    await expect(handlePdfRender(fraction.d, payload("commission_report"))).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("says in the log when the worker may not write the links, and still keeps the documents", async () => {
    const files = new MemoryFiles();
    files.linkResult = "no_privilege";
    const { d } = deps({}, files);
    const before = logs.length;
    const res = await handlePdfRender(d, payload("quote"));
    expect(res.linked).toBe("no_privilege");
    expect(files.rows.size).toBe(2);
    const warn = logs.slice(before).find((l) => l.level === "warn");
    expect(warn?.msg).toMatch(/GRANT UPDATE/);
  });
});
