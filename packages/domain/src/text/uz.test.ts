import { describe, expect, it } from "vitest";
import { normalizeUz, uzSearchKey, uzTextApi } from "./index.ts";

/** Deterministic PRNG (mulberry32); fast-check is not in the dependencies yet. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OKINA = "ʻ"; // U+02BB
const TUTUQ = "ʼ"; // U+02BC
const SINGLE = ["'", "‘", "’", "`", "ʼ", "ʻ", "´"] as const;

describe("normalizeUz: oʻ and gʻ", () => {
  it("BUILD_PLAN acceptance: o'zbek g‘isht -> oʻzbek gʻisht", () => {
    expect(normalizeUz("o'zbek g‘isht")).toBe(`o${OKINA}zbek g${OKINA}isht`);
  });

  it.each(SINGLE)("apostrophe %s after o becomes U+02BB", (mark) => {
    expect(normalizeUz(`qo${mark}l`)).toBe(`qo${OKINA}l`);
  });

  it.each(SINGLE)("apostrophe %s after g becomes U+02BB", (mark) => {
    expect(normalizeUz(`bog${mark}lanish`)).toBe(`bog${OKINA}lanish`);
  });

  it.each([
    ["O'zbekiston", `O${OKINA}zbekiston`],
    ["G'isht", `G${OKINA}isht`],
    ["TOG'", `TOG${OKINA}`],
    ["tog'", `tog${OKINA}`],
    ["yo'q", `yo${OKINA}q`],
  ])("keeps case and word ends: %s", (input, expected) => {
    expect(normalizeUz(input)).toBe(expected);
  });
});

describe("normalizeUz: tutuq belgisi", () => {
  it.each([
    ["ma'lumot", `ma${TUTUQ}lumot`],
    ["san’at", `san${TUTUQ}at`],
    ["is‘temol", `is${TUTUQ}temol`],
    ["e`lon", `e${TUTUQ}lon`],
    ["sunʻiy", `sun${TUTUQ}iy`],
    ["ta'lim", `ta${TUTUQ}lim`],
  ])("other apostrophe between letters -> U+02BC: %s", (input, expected) => {
    expect(normalizeUz(input)).toBe(expected);
  });

  it("handles a sentence with both signs", () => {
    expect(normalizeUz("Ma'lumot: o'zbek tilida, g'isht va san’at")).toBe(
      `Ma${TUTUQ}lumot: o${OKINA}zbek tilida, g${OKINA}isht va san${TUTUQ}at`,
    );
  });
});

describe("normalizeUz: leaves other text alone", () => {
  it.each([
    [""],
    ["   "],
    ["oddiy matn"],
    ["Русский текст без изменений"],
    ["д'Артаньян и д’Артаньян по-русски"],
    ["12 500 000 soʻm"],
    ["emoji 😀 and 'quoted phrase'"],
    ["'start and end'"],
    ["a ' b"],
  ])("unchanged: %j", (input) => {
    // Quoted phrases keep their quotes unless a quote follows o/g; Cyrillic letters are never touched.
    const out = normalizeUz(input);
    expect(out).toBe(input);
  });

  it("does not touch Cyrillic о/г followed by an apostrophe", () => {
    expect(normalizeUz("о'г'")).toBe("о'г'");
  });

  it("is idempotent on already normalized text", () => {
    const text = `o${OKINA}zbek ma${TUTUQ}lumot g${OKINA}isht`;
    expect(normalizeUz(text)).toBe(text);
  });

  it("repairs a misplaced U+02BB between other letters", () => {
    expect(normalizeUz(`sa${OKINA}lom`)).toBe(`sa${TUTUQ}lom`);
  });

  it("throws TypeError for non-string input", () => {
    expect(() => normalizeUz(undefined as unknown as string)).toThrow(TypeError);
    expect(() => normalizeUz(null as unknown as string)).toThrow(TypeError);
    expect(() => normalizeUz(42 as unknown as string)).toThrow(TypeError);
  });
});

describe("uzSearchKey", () => {
  it("o'yin finds oʻyin", () => {
    expect(uzSearchKey("o'yin")).toBe(uzSearchKey(`o${OKINA}yin`));
  });

  it("is lower-case and without apostrophes", () => {
    expect(uzSearchKey("O'ZBEK Ma'lumot")).toBe("ozbek malumot");
  });

  it("matches input typed without the sign (phones without ʻ)", () => {
    expect(uzSearchKey("ozbek")).toBe(uzSearchKey("o'zbek"));
  });

  it("all apostrophe variants give one key", () => {
    const keys = new Set(SINGLE.map((m) => uzSearchKey(`g${m}isht`)));
    expect(keys.size).toBe(1);
    expect(keys.has("gisht")).toBe(true);
  });

  it("trims and collapses whitespace", () => {
    expect(uzSearchKey("  Toshkent \t  shahri \n")).toBe("toshkent shahri");
  });

  it("is lower-case for Cyrillic and mixed text, locale independent", () => {
    expect(uzSearchKey("RTX 5070 Ti")).toBe("rtx 5070 ti");
    expect(uzSearchKey("ВИДЕОКАРТА")).toBe("видеокарта");
    expect(uzSearchKey("I")).toBe("i");
  });

  it("handles empty input and throws TypeError for non-strings", () => {
    expect(uzSearchKey("")).toBe("");
    expect(() => uzSearchKey(undefined as unknown as string)).toThrow(TypeError);
  });

  it("composes decomposed characters", () => {
    expect(uzSearchKey("é")).toBe("é");
  });
});

describe("uzTextApi", () => {
  it("exposes the frozen contract", () => {
    expect(uzTextApi.normalizeUz).toBe(normalizeUz);
    expect(uzTextApi.uzSearchKey).toBe(uzSearchKey);
  });
});

describe("properties (seeded generator)", () => {
  const alphabet = ["o", "g", "O", "G", "a", "k", "z", " ", "'", "‘", "’", "`", "ʼ", "ʻ", "я", "😀", "1"];
  const sample = (rng: () => number): string => {
    const n = Math.floor(rng() * 24);
    let s = "";
    for (let i = 0; i < n; i += 1) s += alphabet[Math.floor(rng() * alphabet.length)];
    return s;
  };

  it("normalizeUz is idempotent", () => {
    const rng = makeRng(20261006);
    for (let i = 0; i < 2000; i += 1) {
      const s = sample(rng);
      const once = normalizeUz(s);
      expect(normalizeUz(once)).toBe(once);
    }
  });

  it("normalizeUz leaves no U+0027, U+2018, U+2019 or U+0060 between Latin letters", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 2000; i += 1) {
      const out = normalizeUz(sample(rng));
      expect(out).not.toMatch(/(?<=\p{Script=Latin})['‘’`](?=\p{Script=Latin})/u);
    }
  });

  it("uzSearchKey is idempotent and equal for every apostrophe spelling", () => {
    const rng = makeRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const s = sample(rng);
      const key = uzSearchKey(s);
      expect(uzSearchKey(key)).toBe(key);
      for (const m of ["'", "’"]) {
        expect(uzSearchKey(s.replaceAll("ʻ", m).replaceAll("ʼ", m))).toBe(key);
      }
    }
  });
});
