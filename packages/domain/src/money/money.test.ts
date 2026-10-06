import { describe, expect, it } from "vitest";
import { addSums, applyBp, bp, roundTo, splitByShares, sum } from "./index.ts";
import { forAll } from "./testkit.ts";

const S = sum;
const B = bp;
type SumT = ReturnType<typeof sum>;
type BpT = ReturnType<typeof bp>;

describe("sum", () => {
  it("accepts safe integers, including zero and negatives (ledger corrections)", () => {
    expect(sum(0)).toBe(0);
    expect(sum(1_500_000)).toBe(1_500_000);
    expect(sum(-5)).toBe(-5);
    expect(sum(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("normalizes negative zero", () => {
    expect(Object.is(sum(-0), 0)).toBe(true);
  });
  it.each([0.5, 1.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    "rejects %s",
    (n) => {
      expect(() => sum(n)).toThrow(RangeError);
    },
  );
  it("rejects non-number input at runtime", () => {
    expect(() => sum("10" as unknown as number)).toThrow(RangeError);
    expect(() => sum(null as unknown as number)).toThrow(RangeError);
    expect(() => sum(undefined as unknown as number)).toThrow(RangeError);
  });
});

describe("bp", () => {
  it.each([0, 1, 1500, 10_000])("accepts %s", (n) => {
    expect(bp(n)).toBe(n);
  });
  it.each([-1, 10_001, 0.5, 1500.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (n) => {
    expect(() => bp(n)).toThrow(RangeError);
  });
});

describe("applyBp", () => {
  // base, rate, floor, half_up, ceil
  const table: [number, number, number, number, number][] = [
    [5_000_000, 1500, 750_000, 750_000, 750_000],
    [6_700_000, 1500, 1_005_000, 1_005_000, 1_005_000],
    [19_999_999, 1500, 2_999_999, 3_000_000, 3_000_000], // 2 999 999.85
    [1, 1500, 0, 0, 1], // 0.15
    [1, 5000, 0, 1, 1], // 0.5 rounds up in half_up
    [3, 1666, 0, 0, 1], // 0.4998
    [10, 5000, 5, 5, 5],
    [0, 1500, 0, 0, 0],
    [1_000_000, 0, 0, 0, 0],
    [1_000_000, 10_000, 1_000_000, 1_000_000, 1_000_000],
    [-7, 5000, -4, -3, -3], // -3.5: floor -4, half_up -3 (towards +inf), ceil -3
  ];
  it.each(table)("applyBp(%i, %i) -> floor %i, half_up %i, ceil %i", (base, rate, fl, hu, ce) => {
    expect(applyBp(S(base), B(rate), "floor")).toBe(fl);
    expect(applyBp(S(base), B(rate), "half_up")).toBe(hu);
    expect(applyBp(S(base), B(rate), "ceil")).toBe(ce);
  });

  it("is exact for bases whose product with the rate exceeds 2^53", () => {
    const base = S(900_000_000_000_001);
    const exact = (BigInt(base) * 1499n) / 10_000n;
    expect(applyBp(base, B(1499), "floor")).toBe(Number(exact));
  });

  it("rejects non-integer base, non-integer rate and unknown mode", () => {
    expect(() => applyBp(1.5 as unknown as SumT, B(1500), "floor")).toThrow(RangeError);
    expect(() => applyBp(S(10), 1500.5 as unknown as BpT, "floor")).toThrow(RangeError);
    expect(() => applyBp(S(10), 10_001 as unknown as BpT, "floor")).toThrow(RangeError);
    expect(() => applyBp(S(10), B(1500), "round" as unknown as "floor")).toThrow(RangeError);
  });

  it("property: floor <= exact <= ceil, ceil - floor <= 1, half_up between them", () => {
    forAll((g) => {
      const base = S(g.int(0, 5_000_000_000));
      const rate = B(g.int(0, 10_000));
      const fl = applyBp(base, rate, "floor");
      const ce = applyBp(base, rate, "ceil");
      const hu = applyBp(base, rate, "half_up");
      expect(fl * 10_000).toBeLessThanOrEqual(base * rate);
      expect(ce * 10_000).toBeGreaterThanOrEqual(base * rate);
      expect(ce - fl).toBeLessThanOrEqual(1);
      expect(hu).toBeGreaterThanOrEqual(fl);
      expect(hu).toBeLessThanOrEqual(ce);
    });
  });
});

describe("roundTo", () => {
  const table: [number, number, number, number, number][] = [
    // value, step, floor, half_up, ceil
    [1_234_567, 1000, 1_234_000, 1_235_000, 1_235_000],
    [1_234_500, 1000, 1_234_000, 1_235_000, 1_235_000],
    [1_234_499, 1000, 1_234_000, 1_234_000, 1_235_000],
    [1_000_000, 1000, 1_000_000, 1_000_000, 1_000_000],
    [149_999, 10_000, 140_000, 150_000, 150_000],
    [0, 10_000, 0, 0, 0],
    [-1500, 1000, -2000, -1000, -1000],
    [7, 1, 7, 7, 7],
  ];
  it.each(table)("roundTo(%i, %i)", (v, step, fl, hu, ce) => {
    expect(roundTo(S(v), step, "floor")).toBe(fl);
    expect(roundTo(S(v), step, "half_up")).toBe(hu);
    expect(roundTo(S(v), step, "ceil")).toBe(ce);
  });
  it.each([0, -1000, 0.5, Number.NaN])("rejects step %s", (step) => {
    expect(() => roundTo(S(10), step, "floor")).toThrow(RangeError);
  });
  it("rejects unknown mode and non-integer value", () => {
    expect(() => roundTo(S(10), 10, "up" as unknown as "floor")).toThrow(RangeError);
    expect(() => roundTo(1.5 as unknown as SumT, 10, "floor")).toThrow(RangeError);
  });
  it("property: result is a multiple of step and within one step of the value", () => {
    forAll((g) => {
      const v = S(g.int(-100_000_000, 100_000_000));
      const step = g.pick([1, 10, 1000, 10_000]);
      for (const mode of ["floor", "half_up", "ceil"] as const) {
        const r = roundTo(v, step, mode);
        expect(r % step === 0).toBe(true);
        expect(Math.abs(r - v)).toBeLessThan(step);
      }
    });
  });
});

describe("splitByShares", () => {
  const table: [number, number[], number[]][] = [
    [1_000_000, [3000, 7000], [300_000, 700_000]],
    [1_000_001, [3000, 7000], [300_000, 700_001]], // 300 000.3 / 700 000.7: largest remainder to the second
    [3_240_001, [5000, 5000], [1_620_001, 1_620_000]], // tie: lower index first
    [100, [3333, 3333, 3334], [33, 33, 34]],
    [1, [3000, 7000], [0, 1]],
    [0, [3000, 7000], [0, 0]],
    [10, [10_000], [10]],
    [10, [0, 10_000], [0, 10]],
    [-101, [5000, 5000], [-50, -51]], // negative corrections keep the sum
  ];
  it.each(table)("splitByShares(%i, %j) -> %j", (total, shares, expected) => {
    expect(splitByShares(S(total), shares.map(B))).toEqual(expected);
  });

  it("rejects shares that do not add up to 10 000, and empty shares", () => {
    expect(() => splitByShares(S(100), [B(3000), B(6000)])).toThrow(RangeError);
    expect(() => splitByShares(S(100), [B(6000), B(6000)])).toThrow(RangeError);
    expect(() => splitByShares(S(100), [])).toThrow(RangeError);
  });
  it("rejects a non-integer total and a share outside 0..10 000", () => {
    expect(() => splitByShares(10.5 as unknown as SumT, [B(10_000)])).toThrow(RangeError);
    expect(() => splitByShares(S(10), [12_000 as unknown as BpT, -2000 as unknown as BpT])).toThrow(RangeError);
  });

  it("property: parts add up to the total and each part is within one sum of its exact share", () => {
    forAll((g) => {
      const total = S(g.int(-1_000_000_000, 5_000_000_000));
      const n = g.int(1, 6);
      const cuts = Array.from({ length: n - 1 }, () => g.int(0, 10_000)).sort((a, b) => a - b);
      const shares: number[] = [];
      let prev = 0;
      for (const c of [...cuts, 10_000]) {
        shares.push(c - prev);
        prev = c;
      }
      const parts = splitByShares(total, shares.map(B));
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      parts.forEach((p, i) => {
        const exact = (total * (shares[i] as number)) / 10_000;
        expect(Math.abs(p - exact)).toBeLessThan(1);
      });
    });
  });
});

describe("addSums", () => {
  it("adds, and returns 0 for no arguments", () => {
    expect(addSums()).toBe(0);
    expect(addSums(S(1), S(2), S(3))).toBe(6);
    expect(addSums(S(10), S(-4))).toBe(6);
  });
  it("throws RangeError on overflow beyond the safe range", () => {
    expect(() => addSums(S(Number.MAX_SAFE_INTEGER), S(1))).toThrow(RangeError);
  });
});
