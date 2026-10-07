// The acceptance of WP-12 (BUILD_PLAN section 5): all the documents in uz and ru; the Uzbek signs; the watermark at `stub`; the
// requisites with the purpose of the payment; no number of a personal card (a test of the templates); the report by item 28 of
// the Regulation No. 489; PDF up to 300 KB. One place that walks through every document, next to the tests of each.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "./index.ts";
import { pdfMessages, pdfText } from "./messages.ts";
import { PDF_MAX_BYTES } from "./render.ts";
import { actFixture, passportFixture, quoteFixture, reportFixture, warrantyFixture } from "./test-support/fixtures.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { PdfLang, RenderOptions } from "./types.ts";

type Maker = (options: RenderOptions) => Promise<Buffer>;

const DOCUMENTS: readonly [string, Maker][] = [
  ["quote", (o) => api.renderQuote(quoteFixture(), o)],
  ["commission_report", (o) => api.renderCommissionReport(reportFixture(), o)],
  ["act_materials", (o) => api.renderAct("material_acceptance", actFixture(), o)],
  ["act_customer_parts", (o) => api.renderAct("customer_parts", actFixture(), o)],
  ["act_handover", (o) => api.renderAct("handover", actFixture(), o)],
  ["passport", (o) => api.renderPassport(passportFixture(), o)],
  ["warranty", (o) => api.renderWarrantyCard(warrantyFixture(), o)],
];
const LANGS: readonly PdfLang[] = ["uz", "ru"];
const CARD = /(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/;

describe("acceptance WP-12", () => {
  it("offers the five contracts of the card: renderQuote, renderCommissionReport, renderAct(kind), renderPassport, renderWarrantyCard", () => {
    for (const name of ["renderQuote", "renderCommissionReport", "renderAct", "renderPassport", "renderWarrantyCard"]) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  for (const [name, make] of DOCUMENTS) {
    for (const lang of LANGS) {
      describe(`${name} in ${lang}`, () => {
        it("is a Buffer with a PDF in it, in the language asked, far under 300 KB, with the fonts cut to the glyphs used", async () => {
          const pdf = await make({ lang, stub: true });
          expect(Buffer.isBuffer(pdf)).toBe(true);
          expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
          expect(pdf.length).toBeLessThan(PDF_MAX_BYTES);
          const parsed = parsePdf(pdf);
          expect(parsed.fonts.length).toBeGreaterThan(0);
          expect(parsed.fonts.every((f) => f.subset)).toBe(true);
          expect(pdf.toString("latin1")).toMatch(lang === "uz" ? /\/Lang \(uz-Latn\)/ : /\/Lang \(ru\)/);
        });

        it("writes the Uzbek signs and the Russian letters, with no missing glyph", async () => {
          const parsed = parsePdf(await make({ lang, stub: true }));
          expect(parsed.text).not.toContain("\u0000");
          expect(parsed.text).not.toContain("�");
          const known = new Set(parsed.fonts.flatMap((f) => [...f.codePoints]));
          if (lang === "uz") {
            expect(parsed.text).toMatch(/[oOgG]ʻ/);
            expect(known.has(0x2bb)).toBe(true);
          } else {
            expect(parsed.text).toMatch(/[А-Яа-яЁё]{4}/);
          }
        });

        it("carries the watermark «NAMUNA / ОБРАЗЕЦ» and the notice at stub, and neither with published texts", async () => {
          const stub = flat(parsePdf(await make({ lang, stub: true })).text);
          expect(stub).toContain("NAMUNA / ОБРАЗЕЦ");
          expect(stub).toContain(flat(pdfText(lang)("common.notice_stub")));
          const clean = flat(parsePdf(await make({ lang, stub: false })).text);
          expect(clean).not.toContain("NAMUNA / ОБРАЗЕЦ");
          expect(clean).not.toContain(flat(pdfText(lang)("common.notice_stub")));
        });

        it("has no number of a bank card", async () => {
          expect(parsePdf(await make({ lang, stub: true })).text).not.toMatch(CARD);
        });
      });
    }
  }

  it("sizes: the heaviest document of the examples stays under 120 KB, the limit is 300 KB", async () => {
    const sizes = await Promise.all(
      DOCUMENTS.flatMap(([, make]) => LANGS.map(async (lang) => (await make({ lang, stub: true })).length)),
    );
    expect(Math.max(...sizes)).toBeLessThan(120 * 1024);
    expect(PDF_MAX_BYTES).toBe(300 * 1024);
  });

  it("gives the account of the sole proprietor with the purpose of the payment in the estimate, and no other way to pay the money for purchases", async () => {
    for (const lang of LANGS) {
      const t = pdfText(lang);
      const text = flat(parsePdf(await api.renderQuote(quoteFixture(), { lang, stub: false })).text);
      expect(text).toContain(flat(t("requisites.purpose")).toString());
      expect(text).toContain(flat(t("requisites.purpose_default", { number: "NV-2026-0001" })));
      expect(text).toContain(flat(t("requisites.note")));
    }
  });

  it("composes the report by item 28 (Regulation, Cabinet resolution No. 489): the seven parts of docs/research/25, 3.2", async () => {
    for (const lang of LANGS) {
      const t = pdfText(lang);
      const text = flat(parsePdf(await api.renderCommissionReport(reportFixture(), { lang, stub: false })).text);
      for (const key of [
        "report.parties.title", // 1 the parties, the contract
        "report.items.title", // 2 the table: name, serial, shop, date, receipt, price, warranty
        "report.discounts.title", // 3 discounts, bonuses, cashback to the customer
        "report.money.title", // 4 received, spent, returns, remainder
        "report.fee.title", // 5 the fee in two lines and how it was paid
        "report.attachments.title", // 6 the attachments
        "report.confirm.title", // 7 the confirmation of the customer and the term of objections
      ]) {
        expect(text, key).toContain(flat(t(key)));
      }
      expect(text).toMatch(/\b28\b/);
      expect(text).toMatch(/\b489\b/);
    }
  });

  describe("the templates hold no card number (CLAUDE.md, red lines of the money)", () => {
    const SRC = fileURLToPath(new URL(".", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : [p];
      });

    it("no sixteen digits in a row in the source, the fixtures or the texts of both languages", () => {
      const sources = files(SRC).filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p));
      for (const p of sources) {
        const text = readFileSync(p, "utf8").replace(/NUMBER_FIELDS|CARD_NUMBER|ACCOUNT_OF_TWENTY/g, "");
        // the card pattern of requisites.ts itself is written with classes, not digits
        expect(CARD.test(text), p).toBe(false);
      }
      for (const lang of LANGS) expect(JSON.stringify(pdfMessages[lang])).not.toMatch(CARD);
    });

    it("the data of a document have no field for a card: nothing to put a number into", () => {
      const types = readFileSync(join(SRC, "types.ts"), "utf8");
      expect(types).not.toMatch(/\b\w*(card|karta|pan)\w*\s*[?:]/i);
      for (const key of [
        "requisites.holder",
        "requisites.inn",
        "requisites.bank",
        "requisites.account",
        "requisites.mfo",
      ]) {
        expect(pdfText("uz").has(key)).toBe(true);
      }
    });

    it("the requisites say the money goes to the account of the IP only, in both languages", () => {
      expect(pdfText("uz")("requisites.note")).toMatch(/YaTT hisob raqamiga/);
      expect(pdfText("ru")("requisites.note")).toMatch(/счёт ИП/);
    });
  });
});
