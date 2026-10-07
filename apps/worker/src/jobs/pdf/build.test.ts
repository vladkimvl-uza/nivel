import {
  type ActKind,
  type CommissionReportDoc,
  type PassportDoc,
  type QuoteDoc,
  renderAct,
  renderCommissionReport,
  renderPassport,
  renderQuote,
  renderWarrantyCard,
  type WarrantyDoc,
} from "@nivel/pdf";
import { describe, expect, it } from "vitest";
import {
  BuildDataError,
  build,
  offersAreStub,
  parseRequisites,
  quoteDoc,
  REQUISITES_KEY,
  rateText,
  readSnapshot,
} from "./build.ts";
import type { PdfRequest } from "./payload.ts";
import {
  ACT_ID,
  act,
  fakeData,
  fakeRows,
  OFFER_RU,
  OFFER_UZ,
  ORDER_ID,
  order,
  P1,
  PURCHASES,
  passport,
  purchase,
  quote,
  quoteLines,
  REQUISITES,
  report,
} from "./test-support/rows.ts";

const CTX = { publicBaseUrl: "https://nivel.uz/" };
const NOW = new Date("2026-10-12T05:00:00.000Z");
const req = (doc: PdfRequest["doc"], actId: string | null = null): PdfRequest => ({ doc, orderId: ORDER_ID, actId });
const built = (r: PdfRequest, over: Parameters<typeof fakeData>[0] = {}) =>
  build(r, fakeRows(fakeData(over)), CTX, NOW);

describe("the offer decides the watermark", () => {
  it("is clean when the offer is published in both languages", () => {
    expect(offersAreStub("published", "published")).toBe(false);
  });

  it("is a sample when one language is only approved by the lawyer or is a stub", () => {
    expect(offersAreStub("published", "lawyer_approved")).toBe(true);
    expect(offersAreStub("stub", "published")).toBe(true);
    expect(offersAreStub("stub", "stub")).toBe(true);
  });

  it("looks at the version the order has fixed, and at the best there is while it has fixed none (before the acceptance)", async () => {
    expect((await built(req("quote"), { offers: { [OFFER_UZ]: "published", [OFFER_RU]: "stub" } })).prepared.stub).toBe(
      true,
    );
    const open = { order: order({ offerUzId: null, offerRuId: null }) };
    expect((await built(req("quote"), { ...open, best: { uz: "published", ru: "published" } })).prepared.stub).toBe(
      false,
    );
    expect(
      (await built(req("quote"), { ...open, best: { uz: "published", ru: "lawyer_approved" } })).prepared.stub,
    ).toBe(true);
    expect((await built(req("quote"), { ...open, best: { uz: "stub", ru: "stub" } })).prepared.stub).toBe(true);
  });
});

describe("the requisites of the sole proprietor from the setting", () => {
  it("reads the six fields, trimmed", () => {
    expect(parseRequisites({ ...REQUISITES, holder: "  YaTT Karimov  " })).toMatchObject({
      holder: "YaTT Karimov",
      inn: "312345678",
      mfo: "00014",
    });
  });

  it("is «not registered» (null) for no setting, a text, a list or an object with nothing in it", () => {
    for (const v of [null, undefined, "x", [], 5, {}, { holder: " ", inn: 7 }])
      expect(parseRequisites(v), JSON.stringify(v)).toBeNull();
  });

  it("keeps only what is there", () => {
    expect(parseRequisites({ account: "20208000412345678001" })).toEqual({
      holder: null,
      inn: null,
      bank: null,
      account: "20208000412345678001",
      mfo: null,
      purpose: null,
    });
  });
});

describe("the rate of the Central Bank as a text", () => {
  it("is grouped and written with a comma, with no float on the way", () => {
    expect(rateText("11772.9500")).toBe("11 772,95");
    expect(rateText("12700.1")).toBe("12 700,10");
    expect(rateText("950")).toBe("950,00");
    expect(rateText("11772.1234")).toBe("11 772,1234");
  });

  it("refuses what is not a number", () => {
    expect(() => rateText("abc")).toThrow(BuildDataError);
    expect(() => rateText("1e5")).toThrow(BuildDataError);
  });
});

describe("the estimate", () => {
  it("takes the money from the columns and the parts of the fee from the stored totals of the domain", () => {
    const q = quote();
    const doc = quoteDoc(order(), q, quoteLines(), null);
    expect(doc.totals).toMatchObject({
      componentsSum: q.componentsSum,
      reserveSum: q.reserveSum,
      purchaseLimit: q.purchaseLimit,
      feeTotal: q.feeTotal,
      feeCommissionLine: q.feeCommissionLine,
      feeWorksLine: q.feeWorksLine,
      advance: q.feeAdvance,
      final: q.feeFinal,
    });
    expect(doc.totals.feeParts.length).toBeGreaterThan(0);
    expect(doc.totals.grandTotal).toBe(q.purchaseLimit + q.feeTotal);
  });

  it("names the shop of reference only when the shop allows its name", () => {
    const doc = quoteDoc(order(), quote(), quoteLines(), null);
    const byTitle = Object.fromEntries(doc.lines.map((l) => [l.title, l.vendorHint]));
    expect(byTitle["AMD Ryzen 5 9600X"]).toBe("Mycom");
    expect(byTitle["GeForce RTX 5070 12 GB"]).toBeNull();
  });

  it("dates the prices by the oldest line, the estimate by its sending, the rate as a text", () => {
    const doc = quoteDoc(order(), quote(), quoteLines(), null);
    expect(doc.priceDate).toBe("2026-10-04");
    expect(doc.issuedAt).toBe("2026-10-05T10:02:00.000Z");
    expect(doc.fx).toEqual({ ccy: "USD", rate: "11 772,95", date: "2026-10-03" });
    expect(doc.validUntil).toBe("2026-10-06T10:02:00.000Z");
    expect(doc.checkedAt).toBe("2026-10-05T10:00:00.000Z");
    const none = quoteDoc(
      order(),
      quote({ fx: null, validUntil: null, manuallyCheckedAt: null, sentAt: null }),
      quoteLines({ priceDate: null }),
      null,
    );
    expect(none).toMatchObject({
      fx: null,
      validUntil: null,
      checkedAt: null,
      priceDate: null,
      issuedAt: "2026-10-05T09:00:00.000Z",
    });
  });

  it("refuses totals that were not stored whole", () => {
    expect(() => quoteDoc(order(), quote({ totals: {} }), quoteLines(), null)).toThrow(BuildDataError);
    expect(() => quoteDoc(order(), quote({ totals: { totals: { fee: { parts: [] } } } }), quoteLines(), null)).toThrow(
      /grandTotal/,
    );
    expect(() =>
      quoteDoc(order(), quote({ totals: { totals: { grandTotal: 1, fee: { parts: [null] } } } }), quoteLines(), null),
    ).toThrow(/fee part 0/);
  });
});

describe("the report", () => {
  it("reads the snapshot of the purchases and adds the names, the serial numbers and the shops from the purchases", async () => {
    const b = await built(req("commission_report"));
    const doc = b.data as CommissionReportDoc;
    expect(doc.lines.map((l) => l.title)).toEqual(["AMD Ryzen 5 9600X", "GeForce RTX 5070 12 GB", "AMD Ryzen 5 9600X"]);
    expect(doc.lines[0]).toMatchObject({
      serials: ["CPU-9600X-001122"],
      vendor: "Mycom",
      vendorWarrantyMonths: 36,
      files: 3,
      isReturn: false,
    });
    expect(doc.lines[2]).toMatchObject({ isReturn: true, amountSum: -140_000 });
    expect(doc.refundsSum).toBe(140_000);
    expect(doc.fee?.total).toBe(quote().feeTotal);
    expect(doc.purchaseLimit).toBe(quote().purchaseLimit);
    expect(doc.feePayments).toEqual([
      { kind: "fee_advance", sum: quote().feeAdvance, receiptNo: "XOL-5530012", at: "2026-10-05T11:00:00.000Z" },
    ]);
    expect(doc.objectionUntil).toBe("2026-10-14T12:30:00.000Z");
    expect(doc.refundDueAt).toBe("2026-10-16T12:30:00.000Z");
  });

  it("takes the term of objections from the order when the report has none yet, and none at all if neither has", async () => {
    const a = await built(req("commission_report"), { report: report({ objectionUntil: null }) });
    expect((a.data as CommissionReportDoc).objectionUntil).toBe("2026-10-14T12:30:00.000Z");
    const b = await built(req("commission_report"), {
      report: report({ objectionUntil: null }),
      order: order({ objectionUntil: null }),
    });
    expect((b.data as CommissionReportDoc).objectionUntil).toBeNull();
  });

  it("prints a dash for a purchase that is no longer in the table, instead of failing the document", async () => {
    const b = await built(req("commission_report"), { purchases: [PURCHASES[0] as (typeof PURCHASES)[number]] });
    expect((b.data as CommissionReportDoc).lines.map((l) => l.title)).toEqual(["AMD Ryzen 5 9600X", "—", "—"]);
  });

  it("refuses a snapshot that is not a list of purchases", () => {
    expect(() => readSnapshot("x")).toThrow(BuildDataError);
    expect(() => readSnapshot([{}])).toThrow(/not a purchase/);
    expect(() =>
      readSnapshot([{ purchaseId: P1, boughtAt: "2026-10-08T00:00:00Z", receiptKind: "cash", qty: 1, amountSum: 1 }]),
    ).toThrow(/kind of receipt/);
    expect(() =>
      readSnapshot([
        { purchaseId: P1, boughtAt: "2026-10-08T00:00:00Z", receiptKind: "fiscal", qty: 1, amountSum: 1.5 },
      ]),
    ).toThrow(/amount/);
  });
});

describe("the acts", () => {
  it("makes the act of handover with the signature and the end of the warranty as a day in Tashkent", async () => {
    const b = await built(req("act_handover", ACT_ID));
    expect(b.actKind).toBe("handover");
    expect(b.data).toMatchObject({
      orderNumber: "NV-2026-0001",
      signed: { at: "2026-10-12T04:15:00.000Z", via: "tg_button" },
      warrantyUntil: "2027-10-12",
    });
    expect((b.data as { receipts?: unknown }).receipts).toBeUndefined();
  });

  it("gives the act of acceptance the prices by the receipts of the purchases, without the returns", async () => {
    const b = await built(req("act_materials"), { acts: [act({ kind: "material_acceptance" })] });
    const receipts = (
      b.data as unknown as { receipts: { title: string; amountSum: number; receiptNo: string | null }[] }
    ).receipts;
    expect(receipts.map((r) => [r.title, r.amountSum, r.receiptNo])).toEqual([
      ["AMD Ryzen 5 9600X", 4_150_000, "0004457812"],
      ["GeForce RTX 5070 12 GB", 9_500_000, "ESF-2026-118342"],
    ]);
  });

  it("takes the latest act of the kind when no id is named, and says so when the order has none", async () => {
    await expect(built(req("act_handover"))).resolves.toMatchObject({ actKind: "handover" });
    await expect(built(req("act_customer_parts"))).rejects.toThrow(/no act customer_parts/);
    await expect(built(req("act_handover", ACT_ID), { acts: [act({ kind: "customer_parts" })] })).rejects.toThrow(
      /is customer_parts, not handover/,
    );
  });

  it("refuses lines of an act that are not a list of items", async () => {
    await expect(built(req("act_handover"), { acts: [act({ lines: "x" })] })).rejects.toThrow(/not a list/);
    await expect(built(req("act_handover"), { acts: [act({ lines: [{ qty: 1 }] })] })).rejects.toThrow(/no title/);
    await expect(built(req("act_handover"), { acts: [act({ lines: [{ title: "x", qty: 1.5 }] })] })).rejects.toThrow(
      /qty/,
    );
  });

  it("leaves the act unsigned while nobody signed", async () => {
    const b = await built(req("act_handover"), { acts: [act({ signedAt: null, signedVia: null })] });
    expect((b.data as { signed: unknown }).signed).toBeNull();
  });
});

describe("the passport and the warranty card", () => {
  it("lists the serial numbers that are there, the protocol of the tests, the photos, and the link of the QR code to the site", async () => {
    const b = await built(req("passport"));
    const doc = b.data as PassportDoc;
    expect(doc.serials).toEqual([
      { label: "CPU", value: "CPU-9600X-001122" },
      { label: "GPU", value: "GPU-5070-778899" },
    ]);
    expect(doc.tests).toEqual({
      tool: "OCCT + FurMark",
      scenario: "CPU + GPU",
      minutes: 420,
      peakTempC: 78,
      errors: [],
    });
    expect(doc).toMatchObject({
      photos: 3,
      sealPhotos: 1,
      labelCode: "NV-0001-A7",
      qr: "https://nivel.uz/p/NV-0001-A7",
    });
    expect(doc.dates).toEqual({
      estimateAt: "2026-10-05T10:02:00.000Z",
      testsAt: "2026-10-11T14:00:00.000Z",
      actAt: "2026-10-12T04:15:00.000Z",
      warrantyUntil: "2027-10-12",
    });
  });

  it("copes with a passport that is half empty: no tests, no photos, no code", async () => {
    const b = await built(req("passport"), {
      passport: passport({
        serials: null,
        tests: null,
        photos: null,
        sealPhotos: undefined,
        labelCode: null,
        biosVersion: null,
        os: null,
        notes: null,
      }),
      estimateSentAt: null,
      testsPassedAt: null,
      handoverSignedAt: null,
    });
    expect(b.data).toMatchObject({
      serials: [],
      tests: null,
      photos: 0,
      sealPhotos: 0,
      qr: null,
      dates: { estimateAt: null, testsAt: null, actAt: null },
    });
  });

  it("keeps only whole numbers and strings of the tests the master wrote", async () => {
    const b = await built(req("passport"), {
      passport: passport({
        tests: { tool: 5, scenario: " ", minutes: 12.5, peakTempC: "hot", errors: ["x", 1, null] },
      }),
    });
    expect((b.data as PassportDoc).tests).toEqual({
      tool: null,
      scenario: null,
      minutes: null,
      peakTempC: null,
      errors: ["x"],
    });
  });

  it("makes the warranty card from the purchases with their serial numbers, and keeps no place to link it", async () => {
    const b = await built(req("warranty"));
    const doc = b.data as WarrantyDoc;
    expect(doc.items.map((i) => [i.title, i.serial, i.vendorWarrantyUntil])).toEqual([
      ["AMD Ryzen 5 9600X", "CPU-9600X-001122", "2029-10-08"],
      ["GeForce RTX 5070 12 GB", "GPU-5070-778899", null],
    ]);
    expect(doc.warrantyUntil).toBe("2027-10-12");
    expect(b.prepared.link).toBeNull();
    expect(b.prepared.fileKind).toBe("warranty_pdf");
  });
});

describe("how a document is named, kept and linked", () => {
  it("names the estimate by its version, links it by the id of the quote and keeps it for the tax term", async () => {
    const b = await built(req("quote"));
    expect(b.prepared).toMatchObject({
      orderNumber: "NV-2026-0001",
      base: "quote-2",
      fileKind: "quote_pdf",
      retention: "tax_5y",
      stub: false,
      demo: false,
      link: { table: "quotes", keyColumn: "id" },
    });
  });

  it("names the report, the act and the passport", async () => {
    expect((await built(req("commission_report"))).prepared).toMatchObject({
      base: "report-1",
      fileKind: "report_pdf",
      link: { table: "commission_reports" },
    });
    expect((await built(req("act_handover"))).prepared).toMatchObject({
      base: `act-handover-${ACT_ID.slice(0, 8)}`,
      fileKind: "act_pdf",
      link: { table: "acts", key: ACT_ID },
    });
    expect((await built(req("act_customer_parts"), { acts: [act({ kind: "customer_parts" })] })).prepared.base).toBe(
      `act-customer-parts-${ACT_ID.slice(0, 8)}`,
    );
    expect((await built(req("passport"))).prepared).toMatchObject({
      base: "passport",
      fileKind: "passport_pdf",
      retention: "order_warranty_plus_3y",
      link: { table: "build_passports", keyColumn: "order_id", key: ORDER_ID },
    });
  });

  it("is a sample when the offer is a stub or the data are demo, and not otherwise", async () => {
    expect((await built(req("quote"), { offers: { [OFFER_UZ]: "stub", [OFFER_RU]: "stub" } })).prepared.stub).toBe(
      true,
    );
    expect((await built(req("quote"))).prepared.stub).toBe(false);
    const demo = await built(req("quote"), { quote: { row: quote(), lines: quoteLines({ demo: true }) } });
    expect(demo.prepared.demo).toBe(true);
    expect((await built(req("commission_report"), { purchases: [purchase({ demo: true })] })).prepared.demo).toBe(true);
  });

  it("reads the requisites setting by the key the bot reads", async () => {
    expect(REQUISITES_KEY).toBe("requisites.ip");
    const rows = fakeRows(fakeData());
    await build(req("quote"), rows, CTX, NOW);
    expect(rows.calls).toContain("setting");
  });

  it("refuses an order that does not exist and an order that has not got the document yet", async () => {
    await expect(built(req("quote"), { order: null })).rejects.toThrow(/does not exist/);
    await expect(built(req("quote"), { order: order({ currentQuoteId: null }) })).rejects.toThrow(/no current quote/);
    await expect(built(req("quote"), { quote: null })).rejects.toThrow(/quote of the order/);
    await expect(built(req("commission_report"), { report: null })).rejects.toThrow(/no report/);
    await expect(built(req("passport"), { passport: null })).rejects.toThrow(/no passport/);
  });
});

describe("what the renderers of @nivel/pdf say to every document made from these rows (the contract between the worker and the package)", () => {
  const options = (lang: "uz" | "ru") => ({ lang, stub: false });

  for (const lang of ["uz", "ru"] as const) {
    it(`renders the estimate, the report, the three acts, the passport and the card in ${lang}`, async () => {
      const bytes: Buffer[] = [];
      bytes.push(await renderQuote((await built(req("quote"))).data as QuoteDoc, options(lang)));
      bytes.push(
        await renderCommissionReport(
          (await built(req("commission_report"))).data as CommissionReportDoc,
          options(lang),
        ),
      );
      for (const [doc, kind] of [
        ["act_materials", "material_acceptance"],
        ["act_customer_parts", "customer_parts"],
        ["act_handover", "handover"],
      ] as const) {
        const b = await built(req(doc), { acts: [act({ kind: kind as ActKind })] });
        bytes.push(await renderAct(kind, b.data as never, options(lang)));
      }
      bytes.push(await renderPassport((await built(req("passport"))).data as PassportDoc, options(lang)));
      bytes.push(await renderWarrantyCard((await built(req("warranty"))).data as WarrantyDoc, options(lang)));
      for (const b of bytes) {
        expect(b.subarray(0, 5).toString()).toBe("%PDF-");
        expect(b.length).toBeLessThan(300 * 1024);
      }
    });
  }
});
