import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCALE, mountFee, noJumpUpTo, pcFee, purchaseReserve } from "./fee-scale.ts";
import { sampleOrder } from "./sample-order.ts";

// The page prices nothing: it shows the scale and the examples, with code of its own (fee-scale.ts), because @nivel/domain is not a
// dependency of apps/web and check-deps forbids a relative import into it. These are the answers of `computeFee` and
// `computeQuote` of packages/domain with DEFAULT_FEE_SETTINGS, taken on 07.10.2026 (the table of CONCEPT 1.2 and the edges of the
// threshold, of the minimum and of the 25 % share of memory). When the domain changes the rule, this table and the page change
// with it. A live parity test against @nivel/domain waits for the dependency (the integrator request in the report of WP-16).

/** [PC estimate, fee on a PC, fee on mounting of the same sum] */
const FEE: readonly (readonly [number, number, number])[] = [
  [5_000_000, 750_000, 750_000],
  [10_000_000, 1_500_000, 1_500_000],
  [15_000_000, 2_250_000, 2_250_000],
  [20_000_000, 3_000_000, 3_000_000],
  [25_000_000, 3_000_000, 3_750_000],
  [30_000_000, 3_000_000, 4_500_000],
  [35_000_000, 3_500_000, 5_250_000],
  [40_000_000, 4_000_000, 6_000_000],
  [45_000_000, 4_500_000, 6_750_000],
  [50_000_000, 5_000_000, 7_500_000],
  [55_000_000, 5_500_000, 8_250_000],
  [60_000_000, 6_000_000, 9_000_000],
  [1, 0, 0],
  [999, 149, 149],
  [6_700_000, 1_005_000, 1_005_000],
  [19_999_999, 2_999_999, 2_999_999],
  [20_000_001, 3_000_000, 3_000_000],
  [29_999_999, 3_000_000, 4_499_999],
  [30_000_001, 3_000_000, 4_500_000],
  [33_333_333, 3_333_333, 4_999_999],
  [59_999_999, 5_999_999, 8_999_999],
  [1_000_000_000, 100_000_000, 150_000_000],
];

/** [parts, of them memory and SSD, reserve rate in basis points, reserve] */
const RESERVE: readonly (readonly [number, number, number, number])[] = [
  [10_000_000, 0, 300, 300_000],
  [10_000_000, 2_499_999, 300, 300_000],
  [10_000_000, 2_500_000, 500, 500_000],
  [10_000_000, 2_500_001, 500, 500_000],
  [33_333_333, 8_333_333, 300, 1_000_000],
  [33_333_333, 8_333_334, 500, 1_670_000],
  [27_650_000, 7_050_000, 500, 1_390_000],
  [1, 1, 500, 10_000],
  [4_999_999, 1_250_000, 500, 250_000],
];

describe("the fee of the page against the answers of the domain", () => {
  it.each(FEE)("a PC estimate of %i: fee %i", (base, onPc) => {
    expect(pcFee(base, DEFAULT_FEE_SCALE)).toBe(onPc);
  });

  it.each(FEE)("mounting of %i: fee %i", (base, _onPc, onMount) => {
    expect(mountFee(base, DEFAULT_FEE_SCALE)).toBe(onMount);
  });

  it("holds the minimum fee up to 30 million, and the rate takes over after it", () => {
    const upTo = noJumpUpTo(DEFAULT_FEE_SCALE);
    expect(upTo).toBe(30_000_000);
    expect(pcFee(upTo - 1, DEFAULT_FEE_SCALE)).toBe(3_000_000);
    expect(pcFee(upTo, DEFAULT_FEE_SCALE)).toBe(3_000_000);
    expect(pcFee(upTo + 10, DEFAULT_FEE_SCALE)).toBe(3_000_001);
  });
});

describe("the reserve of the page against the answers of the domain", () => {
  it.each(RESERVE)("parts %i, memory and SSD %i: rate %i, reserve %i", (parts, memory, rateBp, reserve) => {
    expect(purchaseReserve(parts, memory, DEFAULT_FEE_SCALE)).toEqual({ rateBp, reserve });
  });
});

describe("the sample order NV-0001 against the quote of the domain", () => {
  it("shows the estimate, the fee, the reserve and the purchase limit that computeQuote gives for the same lines", () => {
    const order = sampleOrder(DEFAULT_FEE_SCALE);
    expect(order.partsEstimate).toBe(26_830_000);
    expect(order.fee).toBe(3_000_000);
    expect(order.reserveRateBp).toBe(500);
    expect(order.reserve).toBe(1_350_000);
    expect(order.purchaseLimit).toBe(28_180_000);
    expect(order.total).toBe(29_830_000);
  });
});
