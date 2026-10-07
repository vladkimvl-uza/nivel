import { formatAmount } from "@nivel/ui";
import { describe, expect, it } from "vitest";
import { ACT_KINDS, renderAct } from "./act.ts";
import { pdfText } from "./messages.ts";
import { PDF_MAX_BYTES } from "./render.ts";
import { CardNumberError } from "./requisites.ts";
import { actFixture, CUSTOMER, IP_REQUISITES, ORDER } from "./test-support/fixtures.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { ActDoc, ActKind, PdfLang, RenderOptions } from "./types.ts";

const opts = (lang: PdfLang, over: Partial<RenderOptions> = {}): RenderOptions => ({ lang, stub: false, ...over });
const read = async (kind: ActKind, doc: ActDoc, options: RenderOptions) => {
  const pdf = await renderAct(kind, doc, options);
  const parsed = parsePdf(pdf);
  return { pdf, parsed, text: flat(parsed.text) };
};
const amount = (n: number) => flat(formatAmount(n));

describe("the acts (renderAct)", () => {
  it("knows the three acts of the order: acceptance of the materials, return of the customer's parts, handover", () => {
    expect([...ACT_KINDS]).toEqual(["material_acceptance", "customer_parts", "handover"]);
  });

  for (const lang of ["uz", "ru"] as const) {
    for (const kind of ACT_KINDS) {
      describe(`${kind} in ${lang}`, () => {
        const t = pdfText(lang);
        const doc = actFixture();

        it("has its own title and intro, the order, the customer and the date", async () => {
          const { text, pdf } = await read(kind, doc, opts(lang));
          expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
          expect(text).toContain(flat(t(`act.title.${kind}`)));
          expect(text).toContain(flat(t(`act.intro.${kind}`)));
          expect(text).toContain(ORDER);
          expect(text).toContain(CUSTOMER);
          expect(text).toContain("12.10.2026");
        });

        it("lists the items with quantity and serial number", async () => {
          const { text } = await read(kind, doc, opts(lang));
          expect(text).toContain(flat(t("act.lines.title")));
          for (const l of doc.lines) {
            expect(text, l.title).toContain(flat(l.title));
            if (l.serial) expect(text).toContain(l.serial);
          }
        });

        it("has the block of signatures of both sides, with the sole proprietor named", async () => {
          const { text } = await read(kind, doc, opts(lang));
          expect(text).toContain(flat(t("act.sign.title")));
          expect(text).toContain(flat(t("act.sign.ip")));
          expect(text).toContain(flat(t("act.sign.customer")));
          expect(text).toContain(flat(IP_REQUISITES.holder as string));
        });
      });
    }
  }

  describe("the act of acceptance of the materials", () => {
    it("gives the prices by the receipts, with the total", async () => {
      for (const lang of ["uz", "ru"] as const) {
        const t = pdfText(lang);
        const doc = actFixture();
        const { text } = await read("material_acceptance", doc, opts(lang));
        expect(text).toContain(flat(t("act.receipts.title")));
        for (const r of doc.receipts ?? []) {
          expect(text).toContain(amount(r.amountSum));
          expect(text).toContain(flat(r.receiptNo as string));
        }
        expect(text).toContain(flat(t("act.receipts.total")));
        expect(text).toContain(amount(4_150_000 + 9_500_000));
      }
    });

    it("says there are no purchases by receipts when there are none", async () => {
      const { text } = await read("material_acceptance", actFixture({ receipts: [] }), opts("ru"));
      expect(text).toContain(flat(pdfText("ru")("act.receipts.none")));
    });

    it("refuses a sum that is a fraction", async () => {
      const doc = actFixture({ receipts: [{ title: "x", qty: 1, amountSum: 10.5 }] });
      await expect(renderAct("material_acceptance", doc, opts("uz"))).rejects.toThrow(RangeError);
    });
  });

  describe("the act of handover", () => {
    it("names the end of the warranty, the passport of the build and the absence of claims", async () => {
      for (const lang of ["uz", "ru"] as const) {
        const t = pdfText(lang);
        const { text } = await read("handover", actFixture(), opts(lang));
        expect(text).toContain(flat(t("act.handover.warranty", { date: "12.10.2027" })));
        expect(text).toContain(flat(t("act.handover.passport")));
        expect(text).toContain(flat(t("act.handover.claims")));
        expect(text).not.toContain(flat(t("act.receipts.title")));
      }
    });

    it("says the warranty starts on the day of handover while the date is not known", async () => {
      const { text } = await read("handover", actFixture({ warrantyUntil: null }), opts("ru"));
      expect(text).toContain(flat(pdfText("ru")("act.handover.warranty_pending")));
    });
  });

  describe("the act of return of the customer's parts", () => {
    it("has neither receipts nor warranty", async () => {
      const t = pdfText("ru");
      const { text } = await read("customer_parts", actFixture(), opts("ru"));
      expect(text).not.toContain(flat(t("act.receipts.title")));
      expect(text).not.toContain(flat(t("act.handover.passport")));
    });
  });

  describe("the signature", () => {
    it("records when and how the customer signed, in each of the three ways", async () => {
      for (const lang of ["uz", "ru"] as const) {
        const t = pdfText(lang);
        for (const via of ["tg_button", "paper_photo", "site_button"] as const) {
          const { text } = await read(
            "handover",
            actFixture({ signed: { at: "2026-10-12T09:15:00.000Z", via } }),
            opts(lang),
          );
          expect(text, `${lang} ${via}`).toContain(
            flat(t("act.sign.signed", { at: "12.10.2026 14:15", via: t(`act.sign.via.${via}`) })),
          );
        }
      }
    });

    it("says the act is not signed yet", async () => {
      const { text } = await read("handover", actFixture({ signed: null }), opts("uz"));
      expect(text).toContain(flat(pdfText("uz")("act.sign.unsigned")));
      expect(text).not.toContain("12.10.2026 14:15");
    });

    it("prints «after registration» for the sole proprietor until he is registered", async () => {
      const { text } = await read("handover", actFixture({ ip: null }), opts("ru"));
      expect(text).toContain(flat(pdfText("ru")("common.pending")));
    });
  });

  it("has an empty list of items written as such", async () => {
    const { text } = await read("handover", actFixture({ lines: [] }), opts("ru"));
    expect(text).toContain(flat(pdfText("ru")("act.lines.none")));
  });

  it("draws the watermark on a sample only, stays far under 300 KB, with cut fonts", async () => {
    const clean = await read("handover", actFixture(), opts("uz"));
    expect(clean.text).not.toContain("NAMUNA / ОБРАЗЕЦ");
    for (const kind of ACT_KINDS) {
      const stub = await read(kind, actFixture(), opts("ru", { stub: true }));
      expect(stub.text, kind).toContain("NAMUNA / ОБРАЗЕЦ");
      expect(stub.pdf.length, kind).toBeLessThan(PDF_MAX_BYTES);
      expect(stub.pdf.length, kind).toBeLessThan(100 * 1024);
      expect(stub.parsed.fonts.every((f) => f.subset)).toBe(true);
    }
  });

  it("writes the Uzbek letters with no missing glyph", async () => {
    const doc = actFixture({
      customerName: "Gʻulom Oʻrinboyev",
      lines: [{ title: "Oʻrnatilgan maʼlumot disk", qty: 1 }],
    });
    const { parsed } = await read("handover", doc, opts("uz"));
    expect(parsed.text).not.toContain("\u0000");
    expect(parsed.text).toContain("Gʻulom Oʻrinboyev");
    expect(parsed.text).toContain("Oʻrnatilgan maʼlumot disk");
  });

  it("has no card number and refuses one; refuses an unknown kind and a quantity that is not whole", async () => {
    await expect(
      renderAct("handover", actFixture({ customerName: "8600 1234 1234 1234" }), opts("uz")),
    ).rejects.toThrow(CardNumberError);
    await expect(renderAct("sale" as ActKind, actFixture(), opts("uz"))).rejects.toThrow(/kind/);
    await expect(renderAct("handover", actFixture({ lines: [{ title: "x", qty: 1.5 }] }), opts("uz"))).rejects.toThrow(
      RangeError,
    );
    await expect(renderAct("handover", actFixture({ lines: [{ title: "x", qty: 0 }] }), opts("uz"))).rejects.toThrow(
      RangeError,
    );
  });
});
