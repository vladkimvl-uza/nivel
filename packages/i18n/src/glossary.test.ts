import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_UZ_VARIANTS, glossaryProblems, parseGlossary, validateGlossary } from "./glossary.ts";
import { checkUzString } from "./uz-apostrophes.ts";

const seedUrl = new URL("../../db/seed/glossary/glossary.json", import.meta.url);
const seed: unknown = JSON.parse(readFileSync(seedUrl, "utf8"));

describe("glossary seed (content.glossary, block 26)", () => {
  const terms = parseGlossary(seed);

  it("has exactly 116 terms numbered 1..116 without gaps", () => {
    expect(terms).toHaveLength(116);
    expect(terms.map((t) => t.no)).toEqual(Array.from({ length: 116 }, (_, i) => i + 1));
  });

  it("splits into the six groups of the research tables", () => {
    const count = (g: string) => terms.filter((t) => t.group === g).length;
    expect({
      pc: count("pc"),
      specs: count("specs"),
      peripherals: count("peripherals"),
      workplace: count("workplace"),
      service: count("service"),
      money: count("money"),
    }).toEqual({ pc: 30, specs: 17, peripherals: 18, workplace: 22, service: 17, money: 12 });
  });

  it("passes its own validation", () => {
    expect(validateGlossary(terms)).toEqual([]);
  });

  it("has correct Uzbek apostrophes in every Uzbek term and note", () => {
    for (const t of terms) {
      expect(checkUzString(`glossary #${t.no}`, t.termUz)).toEqual([]);
      expect(t.termUz).not.toMatch(/['’‘`]/);
    }
  });

  it("pins reference rows from the research table", () => {
    const by = (no: number) => terms.find((t) => t.no === no);
    expect(by(9)).toMatchObject({ termRu: "оперативная память", termUz: "operativ xotira" });
    expect(by(89)).toMatchObject({ termRu: "сборка (работа)", termUz: "yigʻish", termUzNewLatin: "yiğiş" });
    expect(by(105)).toMatchObject({ termRu: "плата за услугу", termUz: "xizmat haqi", termUzNewLatin: null });
    expect(by(115)?.termUz).toBe("shaxsga doir maʼlumotlar");
  });

  it("uses null, not a dash, when the spelling does not change", () => {
    expect(terms.every((t) => t.termUzNewLatin !== "—" && t.termUzNewLatin !== "")).toBe(true);
    expect(terms.filter((t) => t.termUzNewLatin === null).length).toBeGreaterThan(40);
  });
});

describe("parseGlossary / validateGlossary", () => {
  const good = {
    no: 1,
    group: "pc",
    termRu: "компьютер",
    termUz: "kompyuter",
    termUzNewLatin: null,
    note: null,
  };

  it("rejects data that is not an array of terms", () => {
    expect(() => parseGlossary({})).toThrow(/array/);
    expect(() => parseGlossary([{ ...good, termUz: 5 }])).toThrow(/termUz/);
    expect(() => parseGlossary([{ ...good, group: "other" }])).toThrow(/group/);
    expect(() => parseGlossary([{ ...good, no: 1.5 }])).toThrow(/no/);
    expect(() => parseGlossary([null])).toThrow(/object/);
    expect(() => parseGlossary([{ ...good, termUzNewLatin: 3 }])).toThrow(/termUzNewLatin/);
    expect(() => parseGlossary([{ ...good, note: 3 }])).toThrow(/note/);
  });

  it("validates count, numbering, empties and apostrophes", () => {
    const one = parseGlossary([good]);
    const problems = validateGlossary(one);
    expect(problems).toContain("glossary has 1 terms, expected 116");
    const dup = validateGlossary(parseGlossary([good, good]));
    expect(dup.join("\n")).toContain("term numbers must be 1..N without gaps or repeats");
    const blank = validateGlossary(parseGlossary([{ ...good, termRu: " " }]));
    expect(blank.join("\n")).toContain("#1: termRu is empty");
    const apos = validateGlossary(parseGlossary([{ ...good, termUz: "o'zbek" }]));
    expect(apos.join("\n")).toContain("#1");
  });
});

describe("glossaryProblems", () => {
  const glossary = parseGlossary(seed);

  it("accepts text that uses glossary terms", () => {
    const r = glossaryProblems("Оперативная память и видеокарта", "Operativ xotira va videokarta", glossary);
    expect(r).toEqual({ errors: [], warnings: [] });
  });

  it("errors on the forbidden variant of RAM", () => {
    const r = glossaryProblems("оперативная память 16 ГБ", "Tezkor xotira 16 GB", glossary);
    expect(r.errors).toEqual(['uz uses "tezkor xotira"; glossary term is "operativ xotira"']);
  });

  it("errors on quvvat manbai for a PSU, but allows it inside the UPS term", () => {
    expect(glossaryProblems("", "Quvvat manbai 650 W", glossary).errors).toHaveLength(1);
    expect(glossaryProblems("ИБП", "Uzluksiz quvvat manbai (UPS)", glossary).errors).toEqual([]);
  });

  it("errors on the informal address 'sen' (use Siz)", () => {
    expect(glossaryProblems("", "Sen tanlaysan", glossary).errors).toHaveLength(1);
    expect(glossaryProblems("", "Senga yordam beramiz", glossary).errors).toHaveLength(1);
    expect(glossaryProblems("", "Sentyabr oyi", glossary).errors).toEqual([]);
  });

  it("warns when the Russian text has a term and the Uzbek text lacks its glossary translation", () => {
    const r = glossaryProblems("Видеокарта RTX", "Grafik karta RTX", glossary);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['ru has "видеокарта" but uz lacks "videokarta" (glossary #6)']);
  });

  it("matches Russian inflections by stem and Uzbek suffixes by substring", () => {
    expect(glossaryProblems("Выберем видеокарты", "Videokartani tanlaymiz", glossary).warnings).toEqual([]);
    expect(glossaryProblems("материнской платы", "ona plata", glossary).warnings).toEqual([]);
  });

  it("matches the Uzbek term regardless of apostrophe style or case", () => {
    expect(glossaryProblems("гарантия", "KAFOLAT beriladi", glossary).warnings).toEqual([]);
    expect(glossaryProblems("сборка (работа)", "Yig'ish", glossary).warnings).toEqual([]);
  });

  it("does not warn on very short terms that would match inside other words", () => {
    expect(glossaryProblems("практика", "amaliyot", glossary).warnings).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(glossaryProblems("", "", glossary)).toEqual({ errors: [], warnings: [] });
  });

  it("exposes the forbidden variants as data for other checks", () => {
    expect(FORBIDDEN_UZ_VARIANTS.map((v) => v.use)).toEqual(
      expect.arrayContaining(["operativ xotira", "quvvat bloki", "Siz"]),
    );
  });
});
