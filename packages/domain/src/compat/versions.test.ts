import { describe, expect, it } from "vitest";
import { compareVersions } from "./versions.ts";

describe("compareVersions", () => {
  it.each([
    ["1.30", "1.20", 1],
    ["1.20", "1.30", -1],
    ["1.20", "1.20", 0],
    ["1.9", "1.10", -1], // numeric, not lexical
    ["2.0", "1.99", 1],
    ["F15", "F9", 1],
    ["F15", "f15", 0],
    ["7D75v1.A0", "7D75v1.A1", -1],
    ["3003", "2801", 1],
    ["1.20", "1.20.1", -1], // a longer version with the same prefix is newer
    ["1.2", "1.02", 0], // leading zeros do not matter
    ["  1.20 ", "1.20", 0],
  ])("compares %s with %s -> %i", (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b) ?? Number.NaN)).toBe(expected);
  });

  it("is antisymmetric", () => {
    const vs = ["F1", "F2", "1.0", "1.0.1", "A", "B2", "2", "10"];
    for (const a of vs) {
      for (const b of vs) {
        const ab = compareVersions(a, b);
        const ba = compareVersions(b, a);
        if (ab === undefined || ba === undefined) expect([ab, ba]).toEqual([undefined, undefined]);
        else expect(Math.sign(ab) + Math.sign(ba)).toBe(0);
      }
    }
  });

  it("cannot order versions of different notations (letters against digits) or without any token", () => {
    expect(compareVersions("1", "A")).toBeUndefined();
    expect(compareVersions("F15", "1.20")).toBeUndefined();
    expect(compareVersions("3003", "7D75v1.A0")).not.toBeUndefined(); // both start with a number
    expect(compareVersions("1.30", "неизвестно")).toBeUndefined();
    expect(compareVersions("?", "1.20")).toBeUndefined();
    expect(compareVersions("", "")).toBeUndefined();
  });
});
