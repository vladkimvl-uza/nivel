import { describe, expect, it } from "vitest";
import { formatMln, formatSumsOf } from "./format.ts";

const NB = " ";

describe("formatMln", () => {
  it.each([
    [20_000_000, "ru", `20${NB}млн`],
    [20_000_000, "uz", `20${NB}mln`],
    [2_250_000, "ru", `2,25${NB}млн`],
    [1_125_000, "uz", `1,125${NB}mln`],
    [750_000, "ru", `0,75${NB}млн`],
    [26_830_000, "ru", `26,83${NB}млн`],
    [3_000_000, "ru", `3${NB}млн`],
    [6_700_000, "uz", `6,7${NB}mln`],
    [0, "ru", `0${NB}млн`],
    [60_000_000, "ru", `60${NB}млн`],
  ] as const)("writes %d sums for %s as %j", (value, locale, expected) => {
    expect(formatMln(value, locale)).toBe(expected);
  });

  it("writes a sum that is not a whole number of thousands in full, with the unit", () => {
    expect(formatMln(2_999_999, "ru")).toBe(`2${NB}999${NB}999${NB}сум`);
    expect(formatMln(2_999_999, "uz")).toBe(`2${NB}999${NB}999${NB}soʻm`);
  });

  it("refuses what is not a whole non-negative number of sums", () => {
    expect(() => formatMln(1.5, "ru")).toThrow(RangeError);
    expect(() => formatMln(-1, "ru")).toThrow(RangeError);
  });
});

describe("formatSumsOf", () => {
  it("writes a sum with the unit of the language", () => {
    expect(formatSumsOf(12_500_000, "uz")).toBe(`12${NB}500${NB}000${NB}soʻm`);
    expect(formatSumsOf(140_000, "ru")).toBe(`140${NB}000${NB}сум`);
  });
});
