import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCALE } from "./fee-scale.ts";
import { SAMPLE_ITEMS, sampleOrder } from "./sample-order.ts";

describe("sample order NV-0001", () => {
  const o = sampleOrder(DEFAULT_FEE_SCALE);

  it("has nine positions with the receipt not above the estimate", () => {
    expect(SAMPLE_ITEMS).toHaveLength(9);
    for (const i of SAMPLE_ITEMS) {
      expect(Number.isSafeInteger(i.estimate)).toBe(true);
      expect(Number.isSafeInteger(i.receipt)).toBe(true);
      expect(i.receipt).toBeLessThanOrEqual(i.estimate);
    }
    expect(new Set(SAMPLE_ITEMS.map((i) => i.id)).size).toBe(9);
  });

  it("adds up the estimate and the receipts in whole sums", () => {
    expect(o.partsEstimate).toBe(26_830_000);
    expect(o.partsReceipts).toBe(26_690_000);
    expect(o.refund).toBe(140_000);
  });

  it("takes the fee by the scale: the minimum of 3 million applies at 26.83 million", () => {
    expect(o.fee).toBe(3_000_000);
    expect(o.feeByRate).toBe(2_683_000);
    expect(o.feeRateBp).toBe(1000);
    expect(o.total).toBe(29_830_000);
  });

  it("takes the purchase limit with the reserve of the domain rule: memory and SSD are over a quarter, so 5 %", () => {
    expect(o.reserveRateBp).toBe(500);
    expect(o.reserve).toBe(1_350_000);
    expect(o.purchaseLimit).toBe(28_180_000);
  });

  it("follows the scale when the owner changes it", () => {
    const s = { ...DEFAULT_FEE_SCALE, pcHighMinFee: 2_000_000, pcHighRateBp: 800 };
    const o2 = sampleOrder(s);
    expect(o2.fee).toBe(2_146_400);
    expect(o2.feeByRate).toBe(2_146_400);
  });

  it("uses the low rate below the threshold of the scale", () => {
    const s = { ...DEFAULT_FEE_SCALE, pcThreshold: 30_000_000 };
    const o3 = sampleOrder(s);
    expect(o3.fee).toBe(4_024_500);
    expect(o3.feeRateBp).toBe(1500);
  });
});
