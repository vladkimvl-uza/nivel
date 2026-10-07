import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEE_SCALE,
  feeChartPoints,
  mountFee,
  noJumpUpTo,
  parseFeeScale,
  pcFee,
  purchaseReserve,
  reserveRange,
  salePercent,
} from "./fee-scale.ts";

const MLN = 1_000_000;

describe("pcFee: the scale of CONCEPT 1.2 and DECISIONS R-8", () => {
  it.each([
    [5 * MLN, 750_000],
    [10 * MLN, 1_500_000],
    [15 * MLN, 2_250_000],
    [19_999_999, 2_999_999], // 15 % of 19 999 999 = 2 999 999.85, rounded down to a whole sum
    [20 * MLN, 3_000_000], // the high rate gives 2 million, the minimum lifts it to 3: no jump at the border
    [25 * MLN, 3_000_000],
    [30 * MLN, 3_000_000],
    [31 * MLN, 3_100_000],
    [40 * MLN, 4_000_000],
    [60 * MLN, 6_000_000],
    [26_830_000, 3_000_000], // the sample order NV-0001
  ])("the fee on %d is %d", (base, fee) => {
    expect(pcFee(base, DEFAULT_FEE_SCALE)).toBe(fee);
  });

  it("rounds down to a whole sum, never up", () => {
    expect(pcFee(1, DEFAULT_FEE_SCALE)).toBe(0);
    expect(pcFee(6, DEFAULT_FEE_SCALE)).toBe(0);
    expect(pcFee(7, DEFAULT_FEE_SCALE)).toBe(1);
  });

  it("keeps every digit for a big base", () => {
    const s = { ...DEFAULT_FEE_SCALE, pcLowRateBp: 1500, pcThreshold: Number.MAX_SAFE_INTEGER };
    expect(pcFee(9_007_199_254_740_991 - 1, s)).toBe(Number((BigInt(9_007_199_254_740_990) * 1500n) / 10_000n));
  });

  it("refuses what is not a whole non-negative number of sums", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pcFee(bad, DEFAULT_FEE_SCALE)).toThrow(RangeError);
    }
  });
});

describe("mountFee", () => {
  it("takes the mount rate", () => {
    expect(mountFee(7_500_000, DEFAULT_FEE_SCALE)).toBe(1_125_000);
    expect(mountFee(0, DEFAULT_FEE_SCALE)).toBe(0);
  });
});

describe("noJumpUpTo", () => {
  it("is the estimate where the high rate catches up with the minimum", () => {
    expect(noJumpUpTo(DEFAULT_FEE_SCALE)).toBe(30 * MLN);
  });
});

describe("salePercent", () => {
  it("writes basis points as a percent with a non-breaking space", () => {
    expect(salePercent(1500)).toBe("15 %");
    expect(salePercent(1000)).toBe("10 %");
    expect(salePercent(300)).toBe("3 %");
    expect(salePercent(1250)).toBe("12,5 %");
    expect(salePercent(5)).toBe("0,05 %");
    expect(salePercent(0)).toBe("0 %");
  });
});

describe("DEFAULT_FEE_SCALE", () => {
  it("holds the rules accepted on 05.10.2026", () => {
    expect(DEFAULT_FEE_SCALE).toMatchObject({
      version: "2026-10-05",
      effectiveFrom: "2026-10-05",
      pcLowRateBp: 1500,
      pcHighRateBp: 1000,
      pcThreshold: 20_000_000,
      pcHighMinFee: 3_000_000,
      mountRateBp: 1500,
      minFullCyclePc: 6_700_000,
      minFreeWindowPc: 4_500_000,
      minFullCycleSetup: 13_300_000,
      advanceBp: 3000,
      reserveBp: 300,
      reserveHighBp: 500,
      reserveHighShareBp: 2500,
      reserveRoundStep: 10_000,
      stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
    });
  });

  it("is frozen: nobody changes the defaults of the whole site", () => {
    expect(Object.isFrozen(DEFAULT_FEE_SCALE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FEE_SCALE.stageSharesBp)).toBe(true);
  });
});

describe("parseFeeScale", () => {
  const stored = {
    version: "2026-12-01",
    effectiveFrom: "2026-12-01",
    pcLowRateBp: 1400,
    pcHighRateBp: 900,
    pcThreshold: 21_000_000,
    pcHighMinFee: 3_150_000,
    mountRateBp: 1500,
    complexRateBp: 1500,
    minFullCyclePc: 7_000_000,
    minFreeWindowPc: 4_500_000,
    minFullCycleSetup: 14_000_000,
    stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
    commissionLineStages: ["selection", "purchase"],
    advanceBp: 3000,
    reserveBp: 300,
    reserveHighBp: 500,
    reserveHighShareBp: 2500,
    reserveRoundStep: 10_000,
    podborShareBp: 2000,
    podborCreditDays: 30,
    afterTestsRetainBp: 8500,
    shelfLifeHours: { components: 24, furniture: 72 },
  };

  it("takes the setting of the owner as it is stored", () => {
    expect(parseFeeScale(stored)).toMatchObject({
      version: "2026-12-01",
      effectiveFrom: "2026-12-01",
      pcLowRateBp: 1400,
      pcThreshold: 21_000_000,
      shelfComponentsHours: 24,
    });
  });

  it("returns null for a setting that is broken, never a guess", () => {
    expect(parseFeeScale(null)).toBeNull();
    expect(parseFeeScale("x")).toBeNull();
    expect(parseFeeScale([])).toBeNull();
    expect(parseFeeScale({ ...stored, pcLowRateBp: 1500.5 })).toBeNull();
    expect(parseFeeScale({ ...stored, pcLowRateBp: 10_001 })).toBeNull();
    expect(parseFeeScale({ ...stored, pcThreshold: -1 })).toBeNull();
    expect(parseFeeScale({ ...stored, pcThreshold: "20000000" })).toBeNull();
    expect(parseFeeScale({ ...stored, effectiveFrom: "05.10.2026" })).toBeNull();
    expect(parseFeeScale({ ...stored, effectiveFrom: "2026-02-30" })).toBeNull();
    expect(
      parseFeeScale({ ...stored, stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1000 } }),
    ).toBeNull();
    expect(parseFeeScale({ ...stored, stageSharesBp: null })).toBeNull();
    expect(parseFeeScale({ ...stored, version: "" })).toBeNull();
    expect(parseFeeScale({ ...stored, pcHighRateBp: 0 })).toBeNull();
    expect(parseFeeScale({ ...stored, reserveRoundStep: 0 })).toBeNull();
    expect(parseFeeScale({ ...stored, reserveHighBp: undefined })).toBeNull();
  });
});

describe("feeChartPoints", () => {
  it("draws the fee on estimates of 5 to 60 million in steps of a quarter million", () => {
    const pts = feeChartPoints(DEFAULT_FEE_SCALE);
    expect(pts[0]).toEqual({ base: 5_000_000, fee: 750_000 });
    expect(pts.at(-1)).toEqual({ base: 60_000_000, fee: 6_000_000 });
    expect(pts).toHaveLength(221);
    // flat at the minimum between 20 and 30 million
    const flat = pts.filter((p) => p.base >= 20_000_000 && p.base <= 30_000_000);
    expect(new Set(flat.map((p) => p.fee))).toEqual(new Set([3_000_000]));
  });
});

describe("purchaseReserve: the reserve of the purchase limit (domain rule of computeQuote)", () => {
  it("is 3 % rounded up to 10 000 sums, and 5 % when memory and SSD are a quarter of the parts or more", () => {
    expect(purchaseReserve(10_000_000, 1_000_000, DEFAULT_FEE_SCALE)).toEqual({ rateBp: 300, reserve: 300_000 });
    expect(purchaseReserve(26_830_000, 7_050_000, DEFAULT_FEE_SCALE)).toEqual({ rateBp: 500, reserve: 1_350_000 });
  });

  it("takes the high rate exactly at the border share", () => {
    expect(purchaseReserve(10_000_000, 2_500_000, DEFAULT_FEE_SCALE).rateBp).toBe(500);
    expect(purchaseReserve(10_000_000, 2_499_999, DEFAULT_FEE_SCALE).rateBp).toBe(300);
  });

  it("rounds up, never down, to the step", () => {
    expect(purchaseReserve(1_000_001, 0, DEFAULT_FEE_SCALE).reserve).toBe(40_000); // 30 000.03 → 40 000
  });

  it("has no reserve when nothing is bought", () => {
    expect(purchaseReserve(0, 0, DEFAULT_FEE_SCALE)).toEqual({ rateBp: 300, reserve: 0 });
  });
});

describe("reserveRange", () => {
  it("writes the low and the high rate as one range", () => {
    expect(reserveRange(DEFAULT_FEE_SCALE)).toBe("3–5 %");
  });
});
