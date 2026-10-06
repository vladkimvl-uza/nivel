import { describe, expect, it } from "vitest";
import { bp, type Sum, sum } from "../money/index.ts";
import { forAll } from "../money/testkit.ts";
import {
  TAX_RISK_RESERVE_BP,
  taxRiskReserve,
  WARRANTY_RESERVE,
  type WarrantyReserveState,
  warrantyReserveContribution,
} from "./index.ts";

const S = sum;
const state = (over: Partial<WarrantyReserveState> = {}): WarrantyReserveState => ({
  balance: S(0),
  closedOrders: 0,
  lossesLast12mBp: bp(0),
  ...over,
});
const mature = (over: Partial<WarrantyReserveState> = {}) =>
  state({ balance: S(10_000_000), closedOrders: 30, ...over });

describe("warrantyReserveContribution: 2 % (at least 150 000), then 1 %", () => {
  it("starting stage: 2 % of the components", () => {
    expect(warrantyReserveContribution(S(10_000_000), state())).toBe(200_000);
    expect(warrantyReserveContribution(S(60_000_000), state())).toBe(1_200_000);
  });

  it("starting stage: not less than 150 000", () => {
    expect(warrantyReserveContribution(S(5_000_000), state())).toBe(150_000);
    expect(warrantyReserveContribution(S(7_500_000), state())).toBe(150_000);
    expect(warrantyReserveContribution(S(7_500_001), state())).toBe(150_001); // 150 000.02 rounds up
  });

  it("stays at 2 % while the balance is below 10 mln or fewer than 30 orders are closed", () => {
    expect(warrantyReserveContribution(S(10_000_000), mature({ balance: S(9_999_999) }))).toBe(200_000);
    expect(warrantyReserveContribution(S(10_000_000), mature({ closedOrders: 29 }))).toBe(200_000);
  });

  it("mature stage: 1 % when losses of the last 12 months are below 0.5 %", () => {
    expect(warrantyReserveContribution(S(10_000_000), mature())).toBe(100_000);
    expect(warrantyReserveContribution(S(10_000_000), mature({ lossesLast12mBp: bp(49) }))).toBe(100_000);
    expect(warrantyReserveContribution(S(3_000_000), mature())).toBe(30_000); // no minimum at 1 %
    expect(warrantyReserveContribution(S(10_000_050), mature())).toBe(100_001); // 100 000.5 rounds up
  });

  it("mature stage with losses of 0.5 % and more returns to 2 % with the minimum", () => {
    expect(warrantyReserveContribution(S(10_000_000), mature({ lossesLast12mBp: bp(50) }))).toBe(200_000);
    expect(warrantyReserveContribution(S(5_000_000), mature({ lossesLast12mBp: bp(120) }))).toBe(150_000);
  });

  it("nothing to reserve for an order without components", () => {
    expect(warrantyReserveContribution(S(0), state())).toBe(0);
  });

  it("rejects negative and fractional input", () => {
    expect(() => warrantyReserveContribution(S(-1), state())).toThrow(RangeError);
    expect(() => warrantyReserveContribution(1.5 as unknown as Sum, state())).toThrow(RangeError);
  });

  it("exposes the rules for the settings screen", () => {
    expect(WARRANTY_RESERVE).toEqual({
      rateBp: 200,
      minSum: 150_000,
      matureRateBp: 100,
      matureBalance: 10_000_000,
      matureOrders: 30,
      matureMaxLossesBp: 50,
    });
  });

  it("property: between 1 % and 2 % of the components, at least the minimum at 2 %", () => {
    forAll((g) => {
      const components = g.int(1, 200_000_000);
      const st = state({
        balance: S(g.int(0, 20_000_000)),
        closedOrders: g.int(0, 60),
        lossesLast12mBp: bp(g.int(0, 200)),
      });
      const r = warrantyReserveContribution(S(components), st);
      expect(r * 100).toBeGreaterThanOrEqual(components);
      expect(r).toBeLessThanOrEqual(Math.max(Math.ceil(components / 50), 150_000));
    });
  });
});

describe("taxRiskReserve: 1 % of purchases until the tax authority answers", () => {
  it("is 1 % of the receipts total when active", () => {
    expect(TAX_RISK_RESERVE_BP).toBe(100);
    expect(taxRiskReserve(S(27_000_000), true)).toBe(270_000);
    expect(taxRiskReserve(S(10_000_050), true)).toBe(100_001); // rounds up
    expect(taxRiskReserve(S(1), true)).toBe(1);
  });
  it("is zero when the written answer has arrived", () => {
    expect(taxRiskReserve(S(27_000_000), false)).toBe(0);
  });
  it("is zero without receipts", () => {
    expect(taxRiskReserve(S(0), true)).toBe(0);
  });
  it("rejects negative and fractional input", () => {
    expect(() => taxRiskReserve(S(-1), true)).toThrow(RangeError);
    expect(() => taxRiskReserve(0.5 as unknown as Sum, true)).toThrow(RangeError);
  });
});
