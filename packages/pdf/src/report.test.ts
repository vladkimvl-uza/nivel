import { formatAmount } from "@nivel/ui";
import { describe, expect, it } from "vitest";
import { pdfText } from "./messages.ts";
import { PDF_MAX_BYTES } from "./render.ts";
import { renderCommissionReport } from "./report.ts";
import { CardNumberError } from "./requisites.ts";
import { CUSTOMER, IP_REQUISITES, ORDER, reportFixture } from "./test-support/fixtures.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { CommissionReportDoc, PdfLang, RenderOptions } from "./types.ts";

const opts = (lang: PdfLang, over: Partial<RenderOptions> = {}): RenderOptions => ({ lang, stub: false, ...over });
const read = async (doc: CommissionReportDoc, options: RenderOptions) => {
  const pdf = await renderCommissionReport(doc, options);
  const parsed = parsePdf(pdf);
  return { pdf, parsed, text: flat(parsed.text) };
};
const amount = (n: number) => flat(formatAmount(n));

describe("the report of the commission agent (renderCommissionReport): the content of item 28 of the Regulation, Cabinet resolution No. 489", () => {
  for (const lang of ["uz", "ru"] as const) {
    describe(`in ${lang}`, () => {
      const t = pdfText(lang);
      const r = reportFixture();

      it("is made by the offer and names item 28 of the Regulation (Cabinet resolution No. 489)", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.title")));
        expect(text).toContain(flat(t("report.basis")));
        expect(text).toMatch(/\b28\b/);
        expect(text).toMatch(/\b489\b/);
        expect(text).toContain(ORDER);
      });

      it("1. names the parties: the sole proprietor with his INN, the customer, the contract (the order) and the estimate", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.parties.title")));
        expect(text).toContain(flat(t("report.parties.commissioner")));
        expect(text).toContain(flat(IP_REQUISITES.holder as string));
        expect(text).toContain(flat(IP_REQUISITES.inn as string));
        expect(text).toContain(flat(t("report.parties.status")));
        expect(text).toContain(CUSTOMER);
        expect(text).toContain(`${flat(t("report.parties.contract"))} ${ORDER}`);
        expect(text).toContain(`${flat(t("report.parties.quote"))} 2`);
      });

      it("2. tables every purchase: name, serial numbers, shop, date, receipt or invoice number, quantity, price, warranty of the shop", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.items.title")));
        for (const l of r.lines) {
          expect(text, l.title).toContain(flat(l.title));
          expect(text).toContain(amount(l.amountSum));
          for (const s of l.serials) expect(text, s).toContain(flat(t("report.item.serial", { serial: s })));
          if (l.vendor) expect(text).toContain(flat(l.vendor));
        }
        expect(text).toContain(flat(t("report.item.fiscal", { no: "0004457812" })));
        expect(text).toContain(flat(t("report.item.esf", { no: "ESF-2026-118342" })));
        expect(text).toContain(flat(t("report.item.no_receipt")));
        expect(text).toContain("08.10.2026");
        expect(text).toContain(flat(t("report.item.warranty_months", { months: 36 })));
        expect(text).toContain(flat(t("report.item.warranty_until", { date: "08.10.2029" })));
        expect(text).toContain(flat(t("report.item.warranty_months", { months: 24 })));
        expect(text).toContain(flat(t("report.item.inn", { inn: "301234567" })));
      });

      it("shows the VAT in the price when the receipt shows it, a return to the shop as a negative sum, and the attached files", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.item.vat", { sum: amount(444_643) })));
        expect(text).toContain(flat(t("report.item.return")));
        expect(text).toContain(amount(-140_000));
        expect(text).toContain(flat(t("report.item.files", { n: 3 })));
      });

      it("3. gives the discounts, bonuses and cashback to the customer", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.discounts.title")));
        expect(text).toContain(flat(t("report.discounts.body")));
        expect(text).toContain(flat(t("report.discounts.sum")));
        expect(text).toContain(amount(r.discountsSum));
        expect(text).toContain("Cashback of the shop");
      });

      it("4. counts the money: received, spent, returned by the shops, the limit, the remainder to return and the day of the return", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.money.received")));
        for (const n of [r.receivedSum, r.spentSum, r.refundsSum, r.purchaseLimit as number, r.remainderSum]) {
          expect(text, String(n)).toContain(amount(n));
        }
        expect(text).toContain(flat(t("report.money.remainder")));
        expect(text).toContain(flat(t("report.money.refund_due", { date: "16.10.2026" })));
        expect(r.receivedSum - r.spentSum).toBe(r.remainderSum);
      });

      it("5. gives the fee in two lines and how it was paid: the receipts of Xolis", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("quote.fee.commission")));
        expect(text).toContain(flat(t("quote.fee.works")));
        expect(text).toContain(amount((r.fee as NonNullable<typeof r.fee>).commissionLine));
        expect(text).toContain(flat(t("report.fee.advance", { no: "XOL-5530012" })));
        expect(text).toContain(flat(t("report.fee.unpaid_final")));
        expect(text).toContain(flat(t("report.fee.no_vat")));
      });

      it("6. counts the attachments: copies of the receipts, invoices, warranty cards and photos of the boxes", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.attachments.title")));
        expect(text).toContain(flat(t("report.attachments.body", { n: 7 })));
      });

      it("7. asks the customer to confirm, with the term of objections of three working days", async () => {
        const { text } = await read(r, opts(lang));
        expect(text).toContain(flat(t("report.confirm.title")));
        expect(text).toContain(flat(t("report.confirm.body", { until: "14.10.2026 17:30" })));
        expect(text).toMatch(/3\s*(ish kuni|рабочих дня)/);
      });
    });
  }

  it("says the term of objections without a date while the report is not sent", async () => {
    const { text } = await read(reportFixture({ sentAt: null, objectionUntil: null }), opts("ru"));
    expect(text).toContain(flat(pdfText("ru")("report.confirm.body_no_date")));
  });

  it("records that the customer confirmed the report or that it is accepted by the term", async () => {
    const t = pdfText("ru");
    const ok = await read(reportFixture({ acceptedAt: "2026-10-10T08:00:00.000Z" }), opts("ru"));
    expect(ok.text).toContain(flat(t("report.confirm.accepted", { date: "10.10.2026" })));
    const deemed = await read(reportFixture({ deemedAcceptedAt: "2026-10-15T08:00:00.000Z" }), opts("ru"));
    expect(deemed.text).toContain(flat(t("report.confirm.deemed", { date: "15.10.2026" })));
  });

  it("prints «after registration» for the sole proprietor until he is registered", async () => {
    const { text } = await read(reportFixture({ ip: null }), opts("uz"));
    expect(text).toContain(flat(pdfText("uz")("common.pending")));
    expect(text).not.toContain(IP_REQUISITES.inn as string);
  });

  it("marks an unpaid fee and a report without purchases, without discounts and without a limit", async () => {
    const t = pdfText("ru");
    const empty = reportFixture({
      lines: [],
      spentSum: 0,
      discountsSum: 0,
      refundsSum: 0,
      remainderSum: 18_000_000,
      purchaseLimit: null,
      feePayments: [],
      fee: null,
    });
    const { text } = await read(empty, opts("ru"));
    expect(text).toContain(flat(t("report.item.none")));
    expect(text).toContain(flat(t("report.discounts.none")));
    expect(text).toContain(flat(t("report.attachments.body", { n: 0 })));
  });

  it("draws the watermark on a sample and not on a published offer; stays far under 300 KB", async () => {
    const clean = await read(reportFixture(), opts("uz"));
    expect(clean.text).not.toContain("NAMUNA / ОБРАЗЕЦ");
    const stub = await read(reportFixture(), opts("ru", { stub: true }));
    expect(stub.text).toContain("NAMUNA / ОБРАЗЕЦ");
    expect(stub.pdf.length).toBeLessThan(PDF_MAX_BYTES);
    expect(stub.pdf.length).toBeLessThan(120 * 1024);
    expect(stub.parsed.fonts.every((f) => f.subset)).toBe(true);
  });

  it("has no number of a bank card, and refuses a card in the requisites or in a note", async () => {
    const { parsed } = await read(reportFixture(), opts("uz", { stub: true }));
    expect(parsed.text).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
    await expect(
      renderCommissionReport(
        reportFixture({ ip: { ...IP_REQUISITES, holder: "карта 8600 1234 1234 1234" } }),
        opts("uz"),
      ),
    ).rejects.toThrow(CardNumberError);
    const first = reportFixture().lines[0] as CommissionReportDoc["lines"][number];
    await expect(
      renderCommissionReport(reportFixture({ lines: [{ ...first, bonusNote: "8600123412341234" }] }), opts("uz")),
    ).rejects.toThrow(CardNumberError);
  });

  it("goes on to further pages for forty purchases", async () => {
    const first = reportFixture().lines[0] as CommissionReportDoc["lines"][number];
    const lines = Array.from({ length: 40 }, (_, i) => ({
      ...first,
      title: `Item ${i + 1}`,
      amountSum: 100_000,
      discountSum: 0,
      files: 1,
    }));
    const doc = reportFixture({
      lines,
      spentSum: 4_000_000,
      discountsSum: 0,
      refundsSum: 0,
      remainderSum: 14_000_000,
    });
    const { parsed, pdf } = await read(doc, opts("ru"));
    expect(parsed.pages.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i <= 40; i++) expect(parsed.text).toContain(`Item ${i}`);
    expect(pdf.length).toBeLessThan(PDF_MAX_BYTES);
  });

  it("refuses a report whose numbers do not add up, the way the database refuses it", async () => {
    const r = reportFixture();
    await expect(renderCommissionReport({ ...r, remainderSum: r.remainderSum + 1 }, opts("uz"))).rejects.toThrow(
      /remainder/,
    );
    await expect(
      renderCommissionReport({ ...r, spentSum: r.spentSum + 1, remainderSum: r.remainderSum - 1 }, opts("uz")),
    ).rejects.toThrow(/purchases/);
    await expect(renderCommissionReport({ ...r, discountsSum: r.discountsSum + 1 }, opts("uz"))).rejects.toThrow(
      /discounts/,
    );
    await expect(renderCommissionReport({ ...r, refundsSum: 1 }, opts("uz"))).rejects.toThrow(/returns/);
    await expect(renderCommissionReport({ ...r, receivedSum: 1.5 }, opts("uz"))).rejects.toThrow(RangeError);
    await expect(
      renderCommissionReport({ ...r, fee: { commissionLine: 1, worksLine: 1, total: 3 } }, opts("uz")),
    ).rejects.toThrow(/fee/);
  });
});
