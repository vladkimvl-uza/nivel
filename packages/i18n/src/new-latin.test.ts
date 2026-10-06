import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGlossary } from "./glossary.ts";
import { DEFAULT_NEW_LATIN_EXCEPTIONS, toNewLatin, toNewLatinMessages } from "./new-latin.ts";

const O = "ʻ";
const T = "ʼ";

describe("toNewLatin (ARCHITECTURE 5.2: oʻ→ö, gʻ→ğ, sh→ş, ch→ç)", () => {
  it.each([
    [`o${O}zbek`, "özbek"],
    [`g${O}isht`, "ğişt"],
    ["shahar", "şahar"],
    ["chiroq", "çiroq"],
    [`yig${O}ish`, "yiğiş"],
    ["sichqoncha", "siçqonça"],
    ["hech", "heç"],
  ])("converts %s to %s", (input, expected) => {
    expect(toNewLatin(input)).toBe(expected);
  });

  it("keeps the case: Oʻ→Ö, Sh→Ş, SH→Ş, CH→Ç", () => {
    expect(toNewLatin(`O${O}zbekcha`)).toBe("Özbekça");
    expect(toNewLatin("Shahar")).toBe("Şahar");
    expect(toNewLatin("SHAHAR")).toBe("ŞAHAR");
    expect(toNewLatin("CHIROQ")).toBe("ÇIROQ");
    expect(toNewLatin(`O${O}Z`)).toBe("ÖZ");
    expect(toNewLatin(`G${O}ISHT`)).toBe("ĞIŞT");
  });

  it("leaves tutuq (U+02BC) and other text unchanged", () => {
    expect(toNewLatin(`ma${T}lumot`)).toBe(`ma${T}lumot`);
    expect(toNewLatin("12 500 000 soʻm")).toBe("12 500 000 söm");
    expect(toNewLatin("")).toBe("");
  });

  it("is idempotent", () => {
    const once = toNewLatin(`O${O}zbekcha shahar chiroq g${O}isht`);
    expect(toNewLatin(once)).toBe(once);
  });

  it("keeps brands and a custom exception list verbatim (whole words, any case)", () => {
    expect(DEFAULT_NEW_LATIN_EXCEPTIONS).toEqual(expect.arrayContaining(["Logitech", "Toshiba"]));
    expect(toNewLatin("Logitech sichqoncha")).toBe("Logitech siçqonça");
    expect(toNewLatin("TOSHIBA disk")).toBe("TOSHIBA disk");
    expect(toNewLatin("mashhur chiroq", { exceptions: ["mashhur"] })).toBe("mashhur çiroq");
    expect(toNewLatin("mashhurlar", { exceptions: ["mashhur"] })).toBe("maşhurlar");
  });

  it("does not touch URLs, e-mail addresses and handles", () => {
    expect(toNewLatin("https://nivel.uz/chek?shop=1 chek")).toBe("https://nivel.uz/chek?shop=1 çek");
    expect(toNewLatin("info@shop.uz shahar")).toBe("info@shop.uz şahar");
    expect(toNewLatin("@chekbot chek")).toBe("@chekbot çek");
  });

  it("does not touch ICU argument names, types or selectors, but converts the text around them", () => {
    expect(toNewLatin("{channel} chiroq")).toBe("{channel} çiroq");
    expect(toNewLatin("{shop, select, chek {chek} other {shahar}}")).toBe("{shop, select, chek {çek} other {şahar}}");
    expect(toNewLatin("{count, plural, one {# kishi} other {# kishi}}")).toBe(
      "{count, plural, one {# kişi} other {# kişi}}",
    );
    expect(toNewLatin("{d, date, short} chek")).toBe("{d, date, short} çek");
  });

  it("does not touch markup tags", () => {
    expect(toNewLatin("<b>chek</b>")).toBe("<b>çek</b>");
    expect(toNewLatin('<a href="https://x.uz/chek">chek</a>')).toBe('<a href="https://x.uz/chek">çek</a>');
  });

  it("leaves U+0027 words alone: input must be normalized first (check-uz-text)", () => {
    expect(toNewLatin("o'zbek")).toBe("o'zbek");
  });
});

describe("toNewLatinMessages", () => {
  it("converts every string of a nested catalog and keeps the structure", () => {
    const input = { a: { b: `O${O}zbek`, c: "shahar" }, d: "chek", n: 5 };
    expect(toNewLatinMessages(input)).toEqual({ a: { b: "Özbek", c: "şahar" }, d: "çek", n: 5 });
  });

  it("does not mutate the input", () => {
    const input = { a: `o${O}` };
    toNewLatinMessages(input);
    expect(input).toEqual({ a: `o${O}` });
  });

  it("converts arrays and leaves null as is", () => {
    expect(toNewLatinMessages({ a: ["shahar", null] })).toEqual({ a: ["şahar", null] });
  });
});

describe("the script reproduces the glossary column «Новая латиница» (block 26, 6)", () => {
  const terms = parseGlossary(
    JSON.parse(readFileSync(new URL("../../db/seed/glossary/glossary.json", import.meta.url), "utf8")),
  );
  // The research table keeps "—" for #3 "butlovchi qismlar", #51 "monitor kronshteyni" and #113 "maishiy pudrat" although
  // they contain ch/sh; the seed repeats the source, the native editor decides (reported as an open question).
  const knownDivergences = new Set([3, 51, 113]);
  const stripParens = (s: string) => s.replace(/\s*\([^)]*\)/g, "");

  it("matches the column for every term except the documented divergences", () => {
    const mismatches = terms
      .filter((t) => !knownDivergences.has(t.no))
      .filter((t) => toNewLatin(stripParens(t.termUz)) !== stripParens(t.termUzNewLatin ?? t.termUz))
      .map(
        (t) =>
          `#${t.no} ${t.termUz}: got "${toNewLatin(stripParens(t.termUz))}", table has "${t.termUzNewLatin ?? t.termUz}"`,
      );
    expect(mismatches).toEqual([]);
  });

  it("records the divergences explicitly, so they do not pass unnoticed", () => {
    const by = (no: number) => terms.find((x) => x.no === no);
    expect(toNewLatin(by(3)?.termUz ?? "")).toBe("butlovçi qismlar");
    expect(toNewLatin(by(51)?.termUz ?? "")).toBe("monitor kronşteyni");
    expect(toNewLatin(by(113)?.termUz ?? "")).toBe("maişiy pudrat");
    for (const no of knownDivergences) expect(by(no)?.termUzNewLatin).toBeNull();
  });
});
