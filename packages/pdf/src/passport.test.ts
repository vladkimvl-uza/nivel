import { describe, expect, it } from "vitest";
import { pdfText } from "./messages.ts";
import { renderPassport } from "./passport.ts";
import { PDF_MAX_BYTES } from "./render.ts";
import { CardNumberError } from "./requisites.ts";
import { CUSTOMER, ORDER, passportFixture } from "./test-support/fixtures.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { PassportDoc, PdfLang, RenderOptions } from "./types.ts";

const opts = (lang: PdfLang, over: Partial<RenderOptions> = {}): RenderOptions => ({ lang, stub: false, ...over });
const read = async (doc: PassportDoc, options: RenderOptions) => {
  const pdf = await renderPassport(doc, options);
  const parsed = parsePdf(pdf);
  return { pdf, parsed, text: flat(parsed.text) };
};

describe("the passport of the build (renderPassport)", () => {
  for (const lang of ["uz", "ru"] as const) {
    describe(`in ${lang}`, () => {
      const t = pdfText(lang);
      const p = passportFixture();

      it("has the title, the order, the customer and the four dates: estimate, tests, act, warranty", async () => {
        const { text, pdf } = await read(p, opts(lang));
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(text).toContain(flat(t("passport.title")));
        expect(text).toContain(ORDER);
        expect(text).toContain(CUSTOMER);
        expect(text).toContain(flat(t("passport.dates.title")));
        for (const [key, date] of [
          ["estimate", "05.10.2026"],
          ["tests", "12.10.2026"],
          ["act", "12.10.2026"],
          ["warranty", "12.10.2027"],
        ] as const) {
          expect(text, key).toContain(flat(t(`passport.dates.${key}`)).toUpperCase());
          expect(text, date).toContain(date);
        }
      });

      it("lists the parts with their serial numbers, the BIOS and the operating system", async () => {
        const { text } = await read(p, opts(lang));
        expect(text).toContain(flat(t("passport.spec.title")));
        for (const s of p.serials) {
          expect(text, s.label).toContain(flat(s.label));
          expect(text, s.value).toContain(s.value);
        }
        expect(text).toContain(flat(t("passport.bios")));
        expect(text).toContain("F14");
        expect(text).toContain(flat(p.os as string));
      });

      it("gives the protocol of the tests: tool, scenario, duration in hours and minutes, the highest temperature, no errors", async () => {
        const { text } = await read(p, opts(lang));
        expect(text).toContain(flat(t("passport.tests.title")));
        expect(text).toContain("OCCT + FurMark");
        expect(text).toContain("CPU + GPU");
        expect(text).toContain(flat(t("passport.tests.duration_value", { hours: 7, minutes: 0 })));
        expect(text).toContain(flat(t("passport.tests.peak_value", { temp: 78 })));
        expect(text).toContain(flat(t("passport.tests.errors_none")));
      });

      it("counts the photos and writes the code of the sticker, the notes, the line of the master and the stamp", async () => {
        const { text } = await read(p, opts(lang));
        expect(text).toContain(flat(t("passport.attachments", { photos: 6, seals: 2 })));
        expect(text).toContain("NV-0001-A7");
        expect(text).toContain(flat(p.notes as string));
        expect(text).toContain(flat(t("passport.master")));
        expect(text.toUpperCase()).toContain(flat(t("passport.stamp.word")).toUpperCase());
      });

      it("prints the caption of the QR code and draws the code as vectors", async () => {
        const { text, pdf } = await read(p, opts(lang));
        expect(text).toContain(flat(t("passport.qr")));
        expect(pdf.toString("latin1")).not.toMatch(/\/Subtype \/Image/);
      });
    });
  }

  it("shows the hours and the minutes of the duration whole", async () => {
    const t = pdfText("uz");
    const doc = passportFixture({ tests: { tool: "x", scenario: "y", minutes: 395, peakTempC: 81, errors: [] } });
    const { text } = await read(doc, opts("uz"));
    expect(text).toContain(flat(t("passport.tests.duration_value", { hours: 6, minutes: 35 })));
  });

  it("counts the errors and gives no stamp of a passed test when there are some", async () => {
    const t = pdfText("ru");
    const doc = passportFixture({
      tests: { tool: "x", scenario: "y", minutes: 420, peakTempC: 81, errors: ["перегрев", "сбой драйвера"] },
    });
    const { text } = await read(doc, opts("ru"));
    expect(text).toContain(flat(t("passport.tests.errors_count", { n: 2 })));
    expect(text).toContain("перегрев");
    expect(text.toUpperCase()).not.toContain(flat(t("passport.stamp.word")).toUpperCase());
  });

  it("says the tests are not entered and gives no stamp, and says the list of serial numbers is empty", async () => {
    const t = pdfText("uz");
    const { text } = await read(passportFixture({ tests: null, serials: [] }), opts("uz"));
    expect(text).toContain(flat(t("passport.tests.none")));
    expect(text).toContain(flat(t("passport.spec.empty")));
    expect(text.toUpperCase()).not.toContain(flat(t("passport.stamp.word")).toUpperCase());
  });

  it("draws no QR code and no caption without a link, and no date that is not there", async () => {
    const t = pdfText("ru");
    const { text } = await read(
      passportFixture({ qr: null, dates: { estimateAt: null, testsAt: null, actAt: null, warrantyUntil: null } }),
      opts("ru"),
    );
    expect(text).not.toContain(flat(t("passport.qr")));
    expect(text).toContain("—");
  });

  it("draws the watermark on a sample only, stays far under 300 KB, with cut fonts", async () => {
    const clean = await read(passportFixture(), opts("uz"));
    expect(clean.text).not.toContain("NAMUNA / ОБРАЗЕЦ");
    const stub = await read(passportFixture(), opts("ru", { stub: true }));
    expect(stub.text).toContain("NAMUNA / ОБРАЗЕЦ");
    expect(stub.pdf.length).toBeLessThan(PDF_MAX_BYTES);
    expect(stub.pdf.length).toBeLessThan(100 * 1024);
    expect(stub.parsed.fonts.every((f) => f.subset)).toBe(true);
  });

  it("writes the Uzbek letters with no missing glyph", async () => {
    const doc = passportFixture({
      customerName: "Oʻtkir Gʻaniyev",
      notes: "Maʼlumot: oʻrnatildi, gʻoya",
      os: "Windows 11",
    });
    const { parsed } = await read(doc, opts("uz"));
    expect(parsed.text).not.toContain("\u0000");
    expect(parsed.text).toContain("Oʻtkir Gʻaniyev");
    expect(parsed.text).toContain("Maʼlumot: oʻrnatildi, gʻoya");
  });

  it("refuses a card number in a note, minutes or temperatures that are not whole, and counts that are not whole", async () => {
    await expect(renderPassport(passportFixture({ notes: "8600 1234 1234 1234" }), opts("uz"))).rejects.toThrow(
      CardNumberError,
    );
    await expect(renderPassport(passportFixture({ tests: { minutes: 12.5, errors: [] } }), opts("uz"))).rejects.toThrow(
      RangeError,
    );
    await expect(
      renderPassport(passportFixture({ tests: { peakTempC: Number.NaN, errors: [] } }), opts("uz")),
    ).rejects.toThrow(RangeError);
    await expect(renderPassport(passportFixture({ photos: -1 }), opts("uz"))).rejects.toThrow(RangeError);
  });

  it("lets a serial number of sixteen digits stand: it is a serial, not a card", async () => {
    const doc = passportFixture({ serials: [{ label: "SSD", value: "1234567890123456" }] });
    const { text } = await read(doc, opts("uz"));
    expect(text).toContain("1234567890123456");
  });
});
