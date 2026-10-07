import { createWorkCalendar } from "@nivel/domain/calendar";
import { warrantyDeadlines } from "@nivel/domain/warranty";
import { describe, expect, it } from "vitest";
import { pdfText } from "./messages.ts";
import { PDF_MAX_BYTES } from "./render.ts";
import { CardNumberError } from "./requisites.ts";
import { CUSTOMER, IP_REQUISITES, ORDER, warrantyFixture } from "./test-support/fixtures.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { PdfLang, RenderOptions, WarrantyDoc } from "./types.ts";
import { renderWarrantyCard } from "./warranty.ts";

const opts = (lang: PdfLang, over: Partial<RenderOptions> = {}): RenderOptions => ({ lang, stub: false, ...over });
const read = async (doc: WarrantyDoc, options: RenderOptions) => {
  const pdf = await renderWarrantyCard(doc, options);
  const parsed = parsePdf(pdf);
  return { pdf, parsed, text: flat(parsed.text) };
};

describe("the warranty card (renderWarrantyCard)", () => {
  for (const lang of ["uz", "ru"] as const) {
    describe(`in ${lang}`, () => {
      const t = pdfText(lang);
      const w = warrantyFixture();

      it("has the title, the order and the customer, and the one-window promise", async () => {
        const { text, pdf } = await read(w, opts(lang));
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(text).toContain(flat(t("warranty.title")));
        expect(text).toContain(CUSTOMER);
        expect(text).toContain(flat(t("warranty.intro", { number: ORDER })));
      });

      it("gives the six points: twelve months, the terms of the reply, the loaner and the fix, the refusal, the journal", async () => {
        const { text } = await read(w, opts(lang));
        for (const n of [1, 2, 3, 4, 5, 6]) expect(text, `p${n}`).toContain(flat(t(`warranty.p${n}`)));
      });

      it("gives the end of the warranty and the parts under it with their serial numbers and the warranty of the shop", async () => {
        const { text } = await read(w, opts(lang));
        expect(text).toContain(flat(t("warranty.until", { date: "12.10.2027" })));
        expect(text).toContain(flat(t("warranty.items.title")));
        for (const i of w.items) {
          expect(text).toContain(flat(i.title));
          if (i.serial) expect(text).toContain(i.serial);
        }
        expect(text).toContain(flat(t("warranty.items.vendor_until", { date: "08.10.2029" })));
        expect(text.toUpperCase()).toContain(flat(t("warranty.stamp")).toUpperCase());
      });

      it("names the sole proprietor who gives the warranty", async () => {
        const { text } = await read(w, opts(lang));
        expect(text).toContain(flat(IP_REQUISITES.holder as string));
      });
    });
  }

  it("holds the terms of the points to those of the domain (warrantyDeadlines): 1 and 2 working days, 3 days, 10 working and 20 days", () => {
    const cal = createWorkCalendar([], { from: "10:00", to: "19:00" });
    const opened = new Date("2026-10-06T06:00:00.000Z");
    const d = warrantyDeadlines(opened, cal);
    const workingDays = (to: Date) => {
      for (let n = 1; n <= 40; n++) if (cal.addWorkingDays(opened, n).getTime() === to.getTime()) return n;
      throw new Error("not a whole number of working days");
    };
    const days = (to: Date) => Math.round((to.getTime() - opened.getTime()) / 86_400_000);
    expect(workingDays(d.reply)).toBe(1);
    expect(workingDays(d.diagnosis)).toBe(2);
    expect(days(d.loaner)).toBe(3);
    expect(workingDays(d.fixWork)).toBe(10);
    expect(days(d.fixParts)).toBe(20);
    for (const lang of ["uz", "ru"] as const) {
      const t = pdfText(lang);
      expect(t("warranty.p2")).toMatch(/\b1\b.*\b2\b/);
      expect(t("warranty.p3")).toMatch(/\b3\b/);
      expect(t("warranty.p4")).toMatch(/\b10\b.*\b20\b/);
      expect(t("warranty.p1")).toMatch(/\b12\b/);
    }
  });

  it("says the warranty starts on the day of handover while that day is not known", async () => {
    const { text } = await read(warrantyFixture({ warrantyUntil: null, handedOverAt: null }), opts("ru"));
    expect(text).toContain(flat(pdfText("ru")("warranty.until_pending")));
  });

  it("says the list of parts is empty, and prints «after registration» for the sole proprietor until he is registered", async () => {
    const t = pdfText("ru");
    const { text } = await read(warrantyFixture({ items: [], ip: null }), opts("ru"));
    expect(text).toContain(flat(t("warranty.items.none")));
    expect(text).toContain(flat(t("common.pending")));
  });

  it("draws the watermark on a sample only, stays far under 300 KB, with cut fonts", async () => {
    const clean = await read(warrantyFixture(), opts("uz"));
    expect(clean.text).not.toContain("NAMUNA / ОБРАЗЕЦ");
    const stub = await read(warrantyFixture(), opts("ru", { stub: true }));
    expect(stub.text).toContain("NAMUNA / ОБРАЗЕЦ");
    expect(stub.pdf.length).toBeLessThan(PDF_MAX_BYTES);
    expect(stub.pdf.length).toBeLessThan(100 * 1024);
    expect(stub.parsed.fonts.every((f) => f.subset)).toBe(true);
  });

  it("writes the Uzbek letters with no missing glyph", async () => {
    const { parsed } = await read(warrantyFixture({ customerName: "Gʻayrat Oʻrolov" }), opts("uz"));
    expect(parsed.text).not.toContain("\u0000");
    expect(parsed.text).toContain("Gʻayrat Oʻrolov");
    expect(parsed.text).toContain(pdfText("uz")("warranty.p5").slice(0, 20));
  });

  it("has no card number and refuses one", async () => {
    const { parsed } = await read(warrantyFixture(), opts("uz", { stub: true }));
    expect(parsed.text).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
    await expect(renderWarrantyCard(warrantyFixture({ customerName: "8600123412341234" }), opts("uz"))).rejects.toThrow(
      CardNumberError,
    );
  });
});
