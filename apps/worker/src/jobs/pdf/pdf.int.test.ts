// pdf.render on the real database: the order walks the road of the product through the scenarios of the services, the job reads it
// as the role nivel_worker, and the documents come out of the rows the services wrote.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatText, parsePdf } from "@nivel/pdf";
import { acts } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerActor, reportSentOrder, sentOrder, settledOrder } from "../../queues/test-support/flow.ts";
import { testRuntime } from "../../queues/test-support/runtime.ts";
import { createWorld, type World } from "../../queues/test-support/world.ts";
import { createFsWriter, createPgDocFiles } from "./files.ts";
import { handlePdfRender } from "./job.ts";
import { parsePdfRequest } from "./payload.ts";
import { pdfDepsOf } from "./register.ts";

let w: World;
let dir: string;
beforeAll(async () => {
  w = await createWorld();
  dir = await mkdtemp(join(tmpdir(), "nivel-pdf-"));
});
afterAll(async () => {
  await w.close();
  await rm(dir, { recursive: true, force: true });
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<T>(sql, params).then((r) => r.rows);

const deps = () => pdfDepsOf(testRuntime(w, { settings: { filesDir: dir, publicBaseUrl: "https://nivel.test" } }).rt);
const textOf = async (key: string) => flatText(parsePdf(await readFile(join(dir, key))).text);
const filesOf = (number: string) =>
  q<{
    storage_key: string;
    kind: string;
    retention_class: string;
    bytes: string;
    sha256: string;
    contains_pd: boolean;
    is_public: boolean;
  }>(
    "select storage_key, kind, retention_class, bytes::text, sha256, contains_pd, is_public from ops.files where storage_key like $1 order by storage_key",
    [`documents/${number}/%`],
  );

describe("the estimate of an order that went out", () => {
  it("is made from the job the services queued, in two languages, with the numbers of the quote", async () => {
    const o = await sentOrder(w);
    const [job] = await q<{ payload: Record<string, unknown> }>(
      "select payload from ops.outbox where payload->>'job' = 'pdf.render' and payload->>'orderId' = $1",
      [o.orderId],
    );
    expect(parsePdfRequest(job?.payload)).toMatchObject({ doc: "quote", orderId: o.orderId });
    const res = await handlePdfRender(deps(), job?.payload);
    expect(res).toMatchObject({ doc: "quote", orderNumber: o.number, uz: { created: true }, ru: { created: true } });

    const files = await filesOf(o.number);
    expect(files.map((f) => f.storage_key)).toEqual([
      `documents/${o.number}/quote-1-ru.pdf`,
      `documents/${o.number}/quote-1-uz.pdf`,
    ]);
    for (const f of files) {
      expect(f).toMatchObject({ kind: "quote_pdf", retention_class: "tax_5y", contains_pd: true, is_public: false });
      expect((await stat(join(dir, f.storage_key))).size).toBe(Number(f.bytes));
      expect(Number(f.bytes)).toBeLessThan(300 * 1024);
    }
    const uz = await textOf(`documents/${o.number}/quote-1-uz.pdf`);
    const ru = await textOf(`documents/${o.number}/quote-1-ru.pdf`);
    expect(uz).toContain(o.number);
    expect(ru).toContain(o.number);
    expect(uz).toContain("Smeta");
    expect(ru).toContain("Смета");
    const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n).replace(/[  ]/g, " ");
    expect(ru).toContain(fmt(o.quote.totals.purchaseLimit));
    expect(ru).toContain(fmt(o.quote.totals.fee.total));
    // published offers in the world: no watermark
    expect(ru).not.toContain("NAMUNA / ОБРАЗЕЦ");
    expect(ru).toContain("после регистрации");
  });

  it("writes the links as far as the role may, and is made once however often the job runs", async () => {
    const o = await sentOrder(w);
    const d = deps();
    const first = await handlePdfRender(d, {
      job: "pdf.render",
      doc: "quote",
      orderId: o.orderId,
      orderNumber: o.number,
    });
    // nivel_worker has no UPDATE on sales.quotes yet (request to the integrator): then the files are kept and the log says so
    expect(["linked", "no_privilege"]).toContain(first.linked);
    const second = await handlePdfRender(d, { job: "pdf.render", doc: "quote", orderId: o.orderId });
    expect(second).toMatchObject({ uz: { created: false }, ru: { created: false } });
    expect(second.uz.id).toBe(first.uz.id);
    expect(await filesOf(o.number)).toHaveLength(2);
  });

  it("links the ids into the quote with the right to do it, once, and leaves a link that is there", async () => {
    const o = await sentOrder(w);
    await handlePdfRender(deps(), { doc: "quote", orderId: o.orderId });
    const files = await filesOf(o.number);
    const ids = await q<{ id: string; storage_key: string }>(
      "select id, storage_key from ops.files where storage_key like $1",
      [`documents/${o.number}/%`],
    );
    const uz = ids.find((i) => i.storage_key.endsWith("-uz.pdf"))?.id as string;
    const ru = ids.find((i) => i.storage_key.endsWith("-ru.pdf"))?.id as string;
    expect(files).toHaveLength(2);
    // the admin panel may write the links; the same code does it
    const asAdmin = createPgDocFiles(w.db, createFsWriter(dir));
    const target = { table: "quotes", keyColumn: "id", key: o.quoteId } as const;
    expect(await asAdmin.link(target, { uz, ru })).toBe("linked");
    const [row] = await q<{ pdf_uz_file_id: string; pdf_ru_file_id: string }>(
      "select pdf_uz_file_id, pdf_ru_file_id from sales.quotes where id = $1",
      [o.quoteId],
    );
    expect(row).toEqual({ pdf_uz_file_id: uz, pdf_ru_file_id: ru });
    expect(await asAdmin.link(target, { uz: ru, ru: uz })).toBe("already");
    const [kept] = await q<{ pdf_uz_file_id: string }>("select pdf_uz_file_id from sales.quotes where id = $1", [
      o.quoteId,
    ]);
    expect(kept?.pdf_uz_file_id).toBe(uz);
  });

  it("puts the watermark on an order whose offer is only a stub", async () => {
    const o = await sentOrder(w);
    const [stub] = await q<{ id: string }>(
      `insert into content.legal_documents (kind, version, lang, body_md, status, text_sha256)
       values ('offer', 'stub-' || gen_random_uuid()::text, 'uz', 'x', 'stub', repeat('a', 64)) returning id`,
    );
    await q("update sales.orders set offer_version_uz_id = $1 where id = $2", [stub?.id, o.orderId]);
    await handlePdfRender(deps(), { doc: "quote", orderId: o.orderId });
    expect(await textOf(`documents/${o.number}/quote-1-uz.pdf`)).toContain("NAMUNA / ОБРАЗЕЦ");
    expect(await textOf(`documents/${o.number}/quote-1-ru.pdf`)).toContain("NAMUNA / ОБРАЗЕЦ");
  });
});

describe("the report, the act, the passport and the warranty card of an order that has gone far", () => {
  it("makes the report with the purchases, the money and the fee of the order", async () => {
    const o = await reportSentOrder(w);
    const res = await handlePdfRender(deps(), {
      job: "pdf.render",
      doc: "commission_report",
      orderId: o.orderId,
      orderNumber: o.number,
    });
    expect(res.doc).toBe("commission_report");
    const [rep] = await q<{ received_sum: string; spent_sum: string; remainder_sum: string }>(
      "select received_sum::text, spent_sum::text, remainder_sum::text from sales.commission_reports where order_id = $1",
      [o.orderId],
    );
    const ru = await textOf(`documents/${o.number}/report-1-ru.pdf`);
    expect(ru).toContain("Отчёт комиссионера");
    expect(ru).toContain("п. 28");
    expect(ru).toContain("489");
    const fmt = (s: string) => new Intl.NumberFormat("ru-RU").format(Number(s)).replace(/[  ]/g, " ");
    expect(ru).toContain(fmt(rep?.spent_sum as string));
    expect(ru).toContain(fmt(rep?.received_sum as string));
    expect(ru).toContain("WCH-");
    expect((await filesOf(o.number)).map((f) => f.kind)).toEqual(["report_pdf", "report_pdf"]);
  });

  it("makes the act that the services queued, from the act of the order", async () => {
    const o = await settledOrder(w);
    const act = await acts.generate(
      { orderId: o.orderId, kind: "material_acceptance", lines: [{ title: "Case of the customer", qty: 1 }] },
      ownerActor(w),
      w.admin,
    );
    const [job] = await q<{ payload: Record<string, unknown> }>(
      "select payload from ops.outbox where payload->>'actId' = $1 and payload->>'job' = 'pdf.render'",
      [act.actId],
    );
    await handlePdfRender(deps(), job?.payload);
    const uz = await textOf(`documents/${o.number}/act-material-acceptance-${act.actId.slice(0, 8)}-uz.pdf`);
    expect(uz).toContain("Mijoz materialini qabul qilish dalolatnomasi");
    expect(uz).toContain("Case of the customer");
    expect(uz).toContain("WCH-");
  });

  it("makes the passport from the row the master filled in, and the warranty card from the purchases", async () => {
    const o = await settledOrder(w);
    await q(
      `insert into sales.build_passports (order_id, serials, bios_version, os, tests, photos, seal_photos, label_code, notes)
       values ($1, $2::jsonb, 'F14', 'Windows 11 Pro', $3::jsonb, '["a","b"]'::jsonb, '["s"]'::jsonb, 'NV-TEST-1', 'ok')`,
      [
        o.orderId,
        JSON.stringify({ CPU: "CPU-001", GPU: "GPU-002" }),
        JSON.stringify({ tool: "OCCT", scenario: "CPU + GPU", minutes: 420, peakTempC: 77, errors: [] }),
      ],
    );
    await handlePdfRender(deps(), { doc: "passport", orderId: o.orderId });
    const ru = await textOf(`documents/${o.number}/passport-ru.pdf`);
    expect(ru).toContain("Паспорт сборки");
    expect(ru).toContain("CPU-001");
    expect(ru).toContain("7 ч 0 мин");
    expect(ru).toContain("77 °C");
    await handlePdfRender(deps(), { doc: "warranty", orderId: o.orderId });
    const uz = await textOf(`documents/${o.number}/warranty-uz.pdf`);
    expect(uz).toContain("Kafolat majburiyati");
    const kinds = (await filesOf(o.number)).map((f) => f.kind);
    expect(kinds).toEqual(["passport_pdf", "passport_pdf", "warranty_pdf", "warranty_pdf"]);
  });

  it("keeps the money red lines: no number of a card in any document of the order", async () => {
    const o = await settledOrder(w);
    await handlePdfRender(deps(), { doc: "commission_report", orderId: o.orderId });
    await handlePdfRender(deps(), { doc: "quote", orderId: o.orderId });
    for (const f of await filesOf(o.number)) {
      const text = parsePdf(await readFile(join(dir, f.storage_key))).text;
      expect(text, f.storage_key).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
    }
  });
});

describe("what the job refuses", () => {
  it("lets an order without a report be tried again, and an unknown order too", async () => {
    const o = await sentOrder(w);
    await expect(handlePdfRender(deps(), { doc: "commission_report", orderId: o.orderId })).rejects.toThrow(
      /no report/,
    );
    await expect(
      handlePdfRender(deps(), { doc: "quote", orderId: "0199aaaa-bbbb-7ccc-8ddd-0000000000ff" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("refuses for good a card number in the requisites of the owner and writes no file", async () => {
    const o = await sentOrder(w);
    await w.db.$client.query(
      `insert into ops.settings (key, value) values ('requisites.ip', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ holder: "YaTT Test", account: "8600 1234 1234 1234" })],
    );
    try {
      await expect(handlePdfRender(deps(), { doc: "quote", orderId: o.orderId })).rejects.toThrow(/card/);
      expect(await filesOf(o.number)).toEqual([]);
    } finally {
      await w.db.$client.query("delete from ops.settings where key = 'requisites.ip'");
    }
  });

  it("uses the requisites the owner entered: the account and the purpose of the payment", async () => {
    const o = await sentOrder(w);
    await w.db.$client.query(
      `insert into ops.settings (key, value) values ('requisites.ip', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [
        JSON.stringify({
          holder: "YaTT Karimov",
          inn: "312345678",
          bank: "Bank X",
          account: "20208000412345678001",
          mfo: "00014",
          purpose: "Средства комитента по заказу {number}",
        }),
      ],
    );
    try {
      await handlePdfRender(deps(), { doc: "quote", orderId: o.orderId });
      const ru = await textOf(`documents/${o.number}/quote-1-ru.pdf`);
      expect(ru).toContain("20208000412345678001");
      expect(ru).toContain(`Средства комитента по заказу ${o.number}`);
      expect(ru).not.toContain("после регистрации");
    } finally {
      await w.db.$client.query("delete from ops.settings where key = 'requisites.ip'");
    }
  });
});
