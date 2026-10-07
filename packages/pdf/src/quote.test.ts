import { formatAmount, formatBp } from "@nivel/ui";
import { describe, expect, it } from "vitest";
import { pdfText } from "./messages.ts";
import { renderQuote } from "./quote.ts";
import { PDF_MAX_BYTES } from "./render.ts";
import { CardNumberError } from "./requisites.ts";
import { IP_REQUISITES, ORDER, quoteFixture } from "./test-support/fixtures.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { PdfLang, QuoteDoc, RenderOptions } from "./types.ts";

const opts = (lang: PdfLang, over: Partial<RenderOptions> = {}): RenderOptions => ({ lang, stub: false, ...over });
const read = async (doc: QuoteDoc, options: RenderOptions) => {
  const pdf = await renderQuote(doc, options);
  return { pdf, parsed: parsePdf(pdf), text: flat(parsePdf(pdf).text) };
};
const amount = (n: number) => flat(formatAmount(n));

describe("the estimate (renderQuote)", () => {
  for (const lang of ["uz", "ru"] as const) {
    describe(`in ${lang}`, () => {
      const t = pdfText(lang);
      const q = quoteFixture();

      it("is a PDF with the title, the number of the order, the version and the customer", async () => {
        const { pdf, text, parsed } = await read(q, opts(lang));
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(text).toContain(flat(t("quote.title")));
        expect(text).toContain(ORDER);
        expect(text).toContain(flat(t("common.version", { version: q.version })));
        expect(text).toContain("Рустам Юсупов / Rustam Yusupov");
        expect(parsed.info.Title).toContain(ORDER);
      });

      it("prints the lines with quantity, the price of the unit and the sum of the line", async () => {
        const { text } = await read(q, opts(lang));
        for (const l of q.lines.filter((x) => !x.customerOwned)) {
          expect(text, l.title).toContain(flat(l.title));
          expect(text, `${l.title} unit`).toContain(amount(l.unitSum));
          expect(text, `${l.title} sum`).toContain(amount(l.qty * l.unitSum));
        }
        expect(text).toContain(amount(2 * 1_150_000));
      });

      it("shows the date of the price, the confidence, the seller of reference and the mark «no return»", async () => {
        const { text } = await read(q, opts(lang));
        expect(text).toContain(flat(t("quote.line.price_date", { date: "05.10.2026" })));
        expect(text).toContain(flat(t("quote.line.confidence.high")));
        expect(text).toContain(flat(t("quote.line.confidence.medium")));
        expect(text).toContain(flat(t("quote.line.confidence.low")));
        expect(text).toContain(flat(t("quote.line.vendor", { name: "Mycom" })));
        expect(text).toContain(flat(t("quote.line.no_return")));
        expect(text).toContain(flat(t("quote.line.return_unknown")));
      });

      it("groups the lines: computer, mounting, outside the scale, the customer's own", async () => {
        const { text } = await read(q, opts(lang));
        for (const g of ["pc", "mount", "outside_scale", "customer_owned"]) {
          expect(text, g).toContain(flat(t(`quote.group.${g}`)));
        }
      });

      it("prints what the domain counted, to the sum: base, reserve with its rate, limit, fee in two lines, stages, grand total", async () => {
        const { text } = await read(q, opts(lang));
        const tt = q.totals;
        for (const n of [
          tt.componentsSum,
          tt.outsideScaleSum,
          tt.reserveSum,
          tt.purchaseLimit,
          tt.feeCommissionLine,
          tt.feeWorksLine,
          tt.feeTotal,
          tt.advance,
          tt.final,
          tt.grandTotal,
        ]) {
          expect(text, String(n)).toContain(amount(n));
        }
        expect(text).toContain(flat(t("quote.totals.reserve", { rate: formatBp(tt.reserveBp) })));
        expect(text).toContain(flat(t("quote.fee.commission")));
        expect(text).toContain(flat(t("quote.fee.works")));
        expect(text).toContain(flat(t("quote.stages.advance")));
        expect(text).toContain(flat(t("quote.stages.final")));
        expect(text).toContain(flat(t("quote.total.grand")));
        expect(text).toContain(flat(t("quote.totals.limit_note")));
      });

      it("prints the parts of the fee: the rule, the base, the rate", async () => {
        const { text } = await read(q, opts(lang));
        for (const p of q.totals.feeParts) {
          expect(text).toContain(flat(t(`quote.fee.rule.${p.rule}`)));
          expect(text).toContain(amount(p.base));
          expect(text).toContain(flat(formatBp(p.rateBp)));
        }
      });

      it("keeps the sums of the stages: advance and final make the fee, the two lines make the fee", () => {
        const tt = q.totals;
        expect(tt.advance + tt.final).toBe(tt.feeTotal);
        expect(tt.feeCommissionLine + tt.feeWorksLine).toBe(tt.feeTotal);
        expect(tt.purchaseLimit + tt.feeTotal).toBe(tt.grandTotal);
      });

      it("gives the term of validity, the rate of the Central Bank and the stamp of the check by hand", async () => {
        const { text } = await read(q, opts(lang));
        expect(text).toContain("06.10.2026");
        expect(text).toContain(flat(t("quote.expiry", { date: "06.10.2026 15:02" })));
        expect(text).toContain(flat(t("quote.fx_value", { ccy: "USD", rate: "11 772,95", date: "03.10.2026" })));
        expect(text.toUpperCase()).toContain(flat(t("quote.stamp_checked")).toUpperCase());
      });

      it("lists the lines without return under their own heading, asking a separate consent", async () => {
        const { text } = await read(q, opts(lang));
        expect(text).toContain(flat(t("quote.nonreturn.title")));
        expect(text).toContain(flat(t("quote.nonreturn.body")));
      });

      it("gives the account of the sole proprietor with the purpose of the payment «without VAT», and says the fee goes by QR Xolis", async () => {
        const { text } = await read(q, opts(lang));
        for (const v of [
          IP_REQUISITES.holder,
          IP_REQUISITES.inn,
          IP_REQUISITES.bank,
          IP_REQUISITES.account,
          IP_REQUISITES.mfo,
        ]) {
          expect(text, String(v)).toContain(flat(String(v)));
        }
        expect(text).toContain(flat(t("requisites.purpose_default", { number: ORDER })));
        expect(text).toContain(flat(t("requisites.fee_channel")));
      });

      it("prints «after registration» for every requisite while the sole proprietor is not registered", async () => {
        const { text } = await read(quoteFixture({ requisites: null }), opts(lang));
        const pending = flat(t("common.pending"));
        expect(text.split(pending).length - 1).toBeGreaterThanOrEqual(5);
        expect(text).not.toContain(IP_REQUISITES.account as string);
      });

      it("has no number of a bank card anywhere", async () => {
        const { parsed } = await read(q, opts(lang, { stub: true }));
        expect(parsed.text).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
      });
    });
  }

  it("draws no watermark on a published offer and «NAMUNA / ОБРАЗЕЦ» with the notice on a placeholder", async () => {
    const q = quoteFixture();
    const clean = await read(q, opts("uz"));
    expect(clean.text).not.toContain("NAMUNA / ОБРАЗЕЦ");
    expect(clean.text).not.toContain(flat(pdfText("uz")("common.notice_stub")));
    for (const lang of ["uz", "ru"] as const) {
      const stub = await read(q, opts(lang, { stub: true }));
      expect(stub.text, lang).toContain("NAMUNA / ОБРАЗЕЦ");
      expect(stub.text, lang).toContain(flat(pdfText(lang)("common.notice_stub")));
    }
  });

  it("marks a document on demo data as a sample too", async () => {
    const demo = await read(quoteFixture(), opts("ru", { demo: true }));
    expect(demo.text).toContain("NAMUNA / ОБРАЗЕЦ");
    expect(demo.text).toContain(flat(pdfText("ru")("common.notice_demo")));
  });

  it("weighs far under 300 KB with the fonts cut to the glyphs used, in both languages", async () => {
    for (const lang of ["uz", "ru"] as const) {
      const { pdf, parsed } = await read(quoteFixture(), opts(lang, { stub: true }));
      expect(pdf.length, lang).toBeLessThan(PDF_MAX_BYTES);
      expect(pdf.length, lang).toBeLessThan(120 * 1024);
      expect(parsed.fonts.every((f) => f.subset)).toBe(true);
    }
  });

  it("writes the Uzbek letters oʻ gʻ and the signs U+02BB and U+02BC with no missing glyph", async () => {
    const { parsed } = await read(
      quoteFixture({ customerName: "Oʻtkir Gʻaniyev, maʼlumot" }),
      opts("uz", { stub: true }),
    );
    expect(parsed.text).not.toContain("\u0000");
    expect(parsed.text).toContain("Oʻtkir Gʻaniyev, maʼlumot");
    const known = new Set(parsed.fonts.flatMap((f) => [...f.codePoints]));
    expect(known.has(0x2bb)).toBe(true);
    expect(known.has(0x2bc)).toBe(true);
  });

  it("goes on a second page for a long list and keeps every row whole", async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      ...(quoteFixture().lines[0] as QuoteDoc["lines"][number]),
      title: `Cable ${i + 1}`,
      unitSum: 10_000 + i,
    }));
    const { parsed, pdf } = await read(quoteFixture({ lines: many }), opts("uz"));
    expect(parsed.pages.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i <= 70; i++) expect(parsed.text).toContain(`Cable ${i}`);
    expect(pdf.length).toBeLessThan(PDF_MAX_BYTES);
  });

  it("refuses a card in the requisites, a fraction or a non-number in the money, and totals that do not add up", async () => {
    const q = quoteFixture();
    await expect(
      renderQuote(quoteFixture({ requisites: { ...IP_REQUISITES, account: "8600 1234 1234 1234" } }), opts("uz")),
    ).rejects.toThrow(CardNumberError);
    await expect(renderQuote(quoteFixture({ customerName: "karta 8600123412341234" }), opts("uz"))).rejects.toThrow(
      CardNumberError,
    );
    await expect(
      renderQuote({ ...q, lines: [{ ...(q.lines[0] as QuoteDoc["lines"][number]), unitSum: 1000.5 }] }, opts("uz")),
    ).rejects.toThrow(RangeError);
    await expect(renderQuote({ ...q, totals: { ...q.totals, grandTotal: Number.NaN } }, opts("uz"))).rejects.toThrow(
      RangeError,
    );
    await expect(renderQuote({ ...q, totals: { ...q.totals, final: q.totals.final + 1 } }, opts("uz"))).rejects.toThrow(
      /advance \+ final/,
    );
    await expect(
      renderQuote({ ...q, totals: { ...q.totals, feeWorksLine: q.totals.feeWorksLine + 1 } }, opts("uz")),
    ).rejects.toThrow(/two lines/);
    await expect(
      renderQuote({ ...q, totals: { ...q.totals, grandTotal: q.totals.grandTotal + 1 } }, opts("uz")),
    ).rejects.toThrow(/grand total/);
  });

  it("renders an estimate without lines, without a customer, without dates and without a rate", async () => {
    const q = quoteFixture();
    const bare = quoteFixture({
      lines: [],
      customerName: null,
      priceDate: null,
      validUntil: null,
      checkedAt: null,
      fx: null,
      totals: { ...q.totals, feeParts: [] },
    });
    const { text } = await read(bare, opts("ru"));
    expect(text).toContain(flat(pdfText("ru")("common.unknown_customer")));
    expect(text).not.toContain(flat(pdfText("ru")("quote.valid_until")).toUpperCase());
  });
});
