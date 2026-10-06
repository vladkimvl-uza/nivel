import { describe, expect, it } from "vitest";
import { checkUzString, suggestUz } from "./uz-apostrophes.ts";

const O = "ʻ"; // ʻ: oʻ, gʻ
const T = "ʼ"; // ʼ: tutuq

describe("checkUzString", () => {
  it("accepts correct Uzbek letters", () => {
    expect(checkUzString("k", `O${O}zbekcha, yig${O}ib, ma${T}lumot`)).toEqual([]);
    expect(checkUzString("k", "Oddiy matn, raqamlar 12 500 000")).toEqual([]);
    expect(checkUzString("k", "")).toEqual([]);
  });

  it("catches U+0027 inside a word and suggests the fix", () => {
    expect(checkUzString("uz/common.json lang.uz", "o'zbek tili")).toEqual([
      `uz/common.json lang.uz: "o'zbek" has U+0027 inside a word; use "o${O}zbek"`,
    ]);
  });

  it.each([
    ["U+2019", "ma’lumot", `ma${T}lumot`],
    ["U+2018", "g‘isht", `g${O}isht`],
    ["U+0060", "o`rnatish", `o${O}rnatish`],
  ])("catches %s", (_name, input, fixed) => {
    const problems = checkUzString("k", input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`use "${fixed}"`);
  });

  it("reports every bad word in a string", () => {
    expect(checkUzString("k", "o'zbek va g'isht, ma'lumot")).toHaveLength(3);
  });

  it("flags U+02BC after o or g (must be U+02BB)", () => {
    expect(checkUzString("k", `o${T}zbek`)).toEqual([`k: "o${T}zbek" has U+02BC after o/g; use "o${O}zbek"`]);
    expect(checkUzString("k", `G${T}isht`)).toHaveLength(1);
  });

  it("flags U+02BB after letters other than o and g (must be U+02BC)", () => {
    expect(checkUzString("k", `ma${O}lumot`)).toEqual([
      `k: "ma${O}lumot" has U+02BB after a letter other than o/g; use "ma${T}lumot"`,
    ]);
  });

  it("allows apostrophes outside words (quotes, ICU quoting)", () => {
    expect(checkUzString("k", "'quoted' va {name}'")).toEqual([]);
    expect(checkUzString("k", "a ' b")).toEqual([]);
  });

  it("handles emoji around the mark", () => {
    expect(checkUzString("k", `🙂 o${O}zbek 🙂`)).toEqual([]);
    expect(checkUzString("k", "🙂 o'zbek 🙂")).toHaveLength(1);
  });
});

describe("suggestUz", () => {
  it("uses U+02BB after o/g and U+02BC elsewhere", () => {
    expect(suggestUz("g'isht")).toBe(`g${O}isht`);
    expect(suggestUz("O'zbek")).toBe(`O${O}zbek`);
    expect(suggestUz("ma’lumot")).toBe(`ma${T}lumot`);
    expect(suggestUz("sun'iy")).toBe(`sun${T}iy`);
  });
});
