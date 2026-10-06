import { describe, expect, it } from "vitest";
import { type Bp, bp, sum } from "../money/index.ts";
import { forAll, type Gen } from "../money/testkit.ts";
import {
  computeFee,
  computeQuote,
  DEFAULT_FEE_SETTINGS,
  type FeeSettings,
  partsBudgetFromTotal,
  podborFee,
  type QuoteContext,
  type QuoteLineInput,
} from "./index.ts";

const S = sum;
const D = DEFAULT_FEE_SETTINGS;
const NOW = new Date("2026-10-06T07:00:00.000Z");

function line(over: Omit<Partial<QuoteLineInput>, "unitSum"> & { unitSum: number }): QuoteLineInput {
  const { unitSum, ...rest } = over;
  return {
    key: rest.key ?? "l",
    group: "pc",
    qty: 1,
    isRamOrSsd: false,
    isFurnitureLike: false,
    customerOwned: false,
    purchasedByIp: true,
    ...rest,
    unitSum: S(unitSum),
  };
}
const pcLine = (amount: number, over: Partial<QuoteLineInput> = {}) => line({ unitSum: amount, ...over });
const ctx = (over: Partial<QuoteContext> = {}): QuoteContext => ({
  now: NOW,
  kind: "pc",
  complexBuild: false,
  freeWindowAvailable: false,
  confirmed: false,
  ...over,
});
const feeOf = (base: number, complexBuild = false) => computeFee([pcLine(base)], D, { complexBuild }).total;

describe("computeFee: CONCEPT 1.2 table", () => {
  // estimate (mln) -> fee (mln)
  it.each([
    [5_000_000, 750_000],
    [10_000_000, 1_500_000],
    [15_000_000, 2_250_000],
    [25_000_000, 3_000_000],
    [40_000_000, 4_000_000],
    [60_000_000, 6_000_000],
    [6_700_000, 1_005_000],
    [29_900_000, 3_000_000],
  ])("PC estimate %i -> fee %i", (base, fee) => {
    expect(feeOf(base)).toBe(fee);
  });

  it("setup: PC and peripherals 17.5 mln + mounting 7.5 mln -> 3.75 mln", () => {
    const f = computeFee(
      [pcLine(17_500_000, { key: "pc" }), line({ key: "desk", group: "mount", unitSum: 7_500_000 })],
      D,
      { complexBuild: false },
    );
    expect(f.total).toBe(3_750_000);
    expect(f.parts.map((p) => [p.group, p.base, p.rateBp, p.amount, p.rule])).toEqual([
      ["pc", 17_500_000, 1500, 2_625_000, "pc_low"],
      ["mount", 7_500_000, 1500, 1_125_000, "mount"],
    ]);
    expect(f.effectiveRateBp).toBe(1500);
  });
});

describe("computeFee: scale boundary at 20 mln", () => {
  it.each([
    [19_999_998, 2_999_999],
    [19_999_999, 2_999_999],
    [20_000_000, 3_000_000],
    [20_000_001, 3_000_000],
    [25_000_000, 3_000_000],
    [30_000_000, 3_000_000],
    [30_000_009, 3_000_000],
    [30_000_010, 3_000_001],
  ])("base %i -> fee %i", (base, fee) => {
    expect(feeOf(base)).toBe(fee);
  });

  it("reports the rule that applied", () => {
    const rule = (b: number) => computeFee([pcLine(b)], D, { complexBuild: false }).parts[0]?.rule;
    expect(rule(19_999_999)).toBe("pc_low");
    expect(rule(20_000_000)).toBe("pc_high_min");
    expect(rule(40_000_000)).toBe("pc_high");
  });

  it("has no jump: neighbouring estimates differ by at most one sum", () => {
    for (let b = 19_999_900; b <= 20_000_100; b++) {
      expect(Math.abs(feeOf(b + 1) - feeOf(b))).toBeLessThanOrEqual(1);
    }
    for (let b = 29_999_990; b <= 30_000_020; b++) {
      expect(Math.abs(feeOf(b + 1) - feeOf(b))).toBeLessThanOrEqual(1);
    }
  });
});

describe("computeFee: complex build, groups and exclusions", () => {
  it("complex build is 15 % at any base", () => {
    expect(feeOf(40_000_000, true)).toBe(6_000_000);
    expect(feeOf(10_000_000, true)).toBe(1_500_000);
    const part = computeFee([pcLine(40_000_000)], D, { complexBuild: true }).parts[0];
    expect(part).toMatchObject({ rule: "complex", rateBp: 1500, amount: 6_000_000 });
  });

  it("complex build does not change the mount group", () => {
    const f = computeFee([line({ group: "mount", unitSum: 1_000_000 })], D, { complexBuild: true });
    expect(f.parts).toEqual([{ group: "mount", base: 1_000_000, rateBp: 1500, amount: 150_000, rule: "mount" }]);
  });

  it("outside-scale lines (licenses, freight, partner works) carry no fee", () => {
    const f = computeFee([pcLine(10_000_000), line({ group: "outside_scale", unitSum: 5_000_000 })], D, {
      complexBuild: false,
    });
    expect(f.total).toBe(1_500_000);
    expect(f.effectiveRateBp).toBe(1500);
  });

  it("customer-owned lines are excluded from the base", () => {
    const f = computeFee([pcLine(10_000_000), pcLine(5_000_000, { customerOwned: true, key: "gpu" })], D, {
      complexBuild: false,
    });
    expect(f.total).toBe(1_500_000);
  });

  it("multiplies by quantity and sums lines of one group before applying the scale", () => {
    const f = computeFee([pcLine(10_000_000, { key: "a", qty: 2 }), pcLine(2_000_000, { key: "b", qty: 0 })], D, {
      complexBuild: false,
    });
    expect(f.parts[0]).toMatchObject({ base: 20_000_000, rule: "pc_high_min", amount: 3_000_000 });
  });

  it("an empty estimate has no parts and zero fee", () => {
    const f = computeFee([], D, { complexBuild: false });
    expect(f).toEqual({ parts: [], total: 0, effectiveRateBp: 0, commissionLine: 0, worksLine: 0 });
  });

  it("rejects negative or fractional quantities and unsafe line sums", () => {
    expect(() => computeFee([pcLine(1_000, { qty: -1 })], D, { complexBuild: false })).toThrow(RangeError);
    expect(() => computeFee([pcLine(-1)], D, { complexBuild: false })).toThrow(RangeError);
    expect(() => computeFee([pcLine(1_000, { qty: 1.5 })], D, { complexBuild: false })).toThrow(RangeError);
    expect(() => computeFee([pcLine(Number.MAX_SAFE_INTEGER, { qty: 2 })], D, { complexBuild: false })).toThrow(
      RangeError,
    );
  });
});

describe("computeFee: two document lines (commission and works)", () => {
  it("splits 50/50 by the stage price list and always adds up", () => {
    const f = computeFee([pcLine(10_000_000)], D, { complexBuild: false });
    expect(f.commissionLine).toBe(750_000);
    expect(f.worksLine).toBe(750_000);
  });
  it("gives the odd sum to the commission line (lower index wins ties)", () => {
    const f = computeFee([pcLine(6_700_001)], D, { complexBuild: false }); // 1 005 000.15 -> 1 005 000
    expect(f.total).toBe(1_005_000);
    const g = computeFee([pcLine(6_700_007)], D, { complexBuild: false }); // 1 005 001.05 -> 1 005 001
    expect(g.total).toBe(1_005_001);
    expect([g.commissionLine, g.worksLine]).toEqual([502_501, 502_500]);
  });
  it("follows the configured commission stages", () => {
    const s: FeeSettings = { ...D, commissionLineStages: ["selection"] };
    const f = computeFee([pcLine(10_000_000)], s, { complexBuild: false });
    expect([f.commissionLine, f.worksLine]).toEqual([300_000, 1_200_000]);
    const none: FeeSettings = { ...D, commissionLineStages: [] };
    expect(computeFee([pcLine(10_000_000)], none, { complexBuild: false }).commissionLine).toBe(0);
    const dup: FeeSettings = { ...D, commissionLineStages: ["selection", "selection"] };
    expect(computeFee([pcLine(10_000_000)], dup, { complexBuild: false }).commissionLine).toBe(300_000);
  });
});

describe("computeFee: properties", () => {
  const randomLines = (g: Gen): QuoteLineInput[] =>
    Array.from({ length: g.int(1, 8) }, (_, i) =>
      line({
        key: `k${i}`,
        group: g.pick(["pc", "mount", "outside_scale"] as const),
        qty: g.int(0, 4),
        unitSum: g.int(0, 30_000_000),
        customerOwned: g.int(0, 5) === 0,
      }),
    );

  it("parts and both document lines add up to the total", () => {
    forAll((g) => {
      const f = computeFee(randomLines(g), D, { complexBuild: g.bool() });
      expect(f.parts.reduce((a, p) => a + p.amount, 0)).toBe(f.total);
      expect(f.commissionLine + f.worksLine).toBe(f.total);
      expect(f.effectiveRateBp).toBeLessThanOrEqual(1500);
    });
  });

  it("fee <= 15 % of the base, and >= 10 % for bases from 6.7 mln without complex build", () => {
    forAll(
      (g) => {
        const base = g.int(6_700_000, 400_000_000);
        const fee = feeOf(base);
        expect(fee * 10_000).toBeLessThanOrEqual(base * 1500);
        expect(fee).toBeGreaterThanOrEqual(Math.floor(base / 10));
        expect(fee).toBeGreaterThanOrEqual(Math.floor((base * 1000) / 10_000));
      },
      { runs: 2000 },
    );
  });

  it("fee never decreases when the base grows", () => {
    forAll((g) => {
      const a = g.int(0, 100_000_000);
      const b = a + g.int(0, 100_000_000);
      expect(feeOf(b)).toBeGreaterThanOrEqual(feeOf(a));
    });
  });
});

describe("podborFee", () => {
  it("is 20 % of the fee rounded down", () => {
    expect(podborFee(computeFee([pcLine(10_000_000)], D, { complexBuild: false }), D)).toBe(300_000);
    expect(podborFee(computeFee([pcLine(6_700_000)], D, { complexBuild: false }), D)).toBe(201_000);
    expect(podborFee(computeFee([pcLine(6_700_007)], D, { complexBuild: false }), D)).toBe(201_000); // 201 000.2
    expect(podborFee(computeFee([pcLine(40_000_000)], D, { complexBuild: false }), D)).toBe(800_000);
  });
  it("is zero for an empty estimate", () => {
    expect(podborFee(computeFee([], D, { complexBuild: false }), D)).toBe(0);
  });
  it("follows the configured share", () => {
    const f = computeFee([pcLine(10_000_000)], D, { complexBuild: false });
    expect(podborFee(f, { ...D, podborShareBp: bp(1000) })).toBe(150_000);
  });
});

describe("computeQuote: totals", () => {
  it("builds the totals of a 10 mln PC", () => {
    const q = computeQuote([pcLine(10_000_000)], D, ctx());
    expect(q).toMatchObject({
      componentsSum: 10_000_000,
      outsideScaleSum: 0,
      reserveBp: 300,
      reserveSum: 300_000,
      purchaseLimit: 10_300_000,
      advance: 450_000,
      final: 1_050_000,
      grandTotal: 11_800_000,
      eligibility: { mode: "full_cycle" },
      warnings: [],
    });
    expect(q.fee.total).toBe(1_500_000);
    expect(q).not.toHaveProperty("validUntil");
  });

  it("advance + final === fee, also for odd fees", () => {
    const q = computeQuote([pcLine(6_700_007)], D, ctx());
    expect(q.fee.total).toBe(1_005_001);
    expect(q.advance).toBe(301_500); // 301 500.3
    expect(q.final).toBe(703_501);
    expect(q.advance + q.final).toBe(q.fee.total);
  });

  it("rounds the reserve up to 10 000 and applies it to the lines bought by the IP", () => {
    const q = computeQuote([pcLine(10_000_001)], D, ctx());
    expect(q.reserveSum).toBe(310_000);
    const q2 = computeQuote(
      [pcLine(10_000_000), pcLine(4_000_000, { key: "own-purchase", purchasedByIp: false })],
      D,
      ctx(),
    );
    expect(q2.reserveSum).toBe(300_000);
    expect(q2.purchaseLimit).toBe(10_300_000);
    expect(q2.componentsSum).toBe(14_000_000); // fee base does not depend on who buys
  });

  it("outside-scale lines bought by the IP enter the limit but not the fee base", () => {
    const q = computeQuote(
      [pcLine(10_000_000), line({ key: "win", group: "outside_scale", unitSum: 2_000_000 })],
      D,
      ctx(),
    );
    expect(q.outsideScaleSum).toBe(2_000_000);
    expect(q.componentsSum).toBe(10_000_000);
    expect(q.reserveSum).toBe(360_000);
    expect(q.purchaseLimit).toBe(12_360_000);
    expect(q.grandTotal).toBe(12_360_000 + 1_500_000);
  });

  it("ignores customer-owned lines everywhere", () => {
    const q = computeQuote(
      [pcLine(10_000_000), pcLine(3_000_000, { key: "own", customerOwned: true, purchasedByIp: false })],
      D,
      ctx(),
    );
    expect(q.componentsSum).toBe(10_000_000);
    expect(q.purchaseLimit).toBe(10_300_000);
  });

  it("an empty estimate has no limit, no fee and a warning", () => {
    const q = computeQuote([], D, ctx());
    expect(q).toMatchObject({ componentsSum: 0, reserveSum: 0, purchaseLimit: 0, grandTotal: 0, advance: 0, final: 0 });
    expect(q.eligibility).toEqual({ mode: "podbor_only", reason: "below_min" });
    expect(q.warnings).toEqual([{ key: "quote.empty" }]);
  });

  it("uses the complex-build rate from the context", () => {
    expect(computeQuote([pcLine(40_000_000)], D, ctx({ complexBuild: true })).fee.total).toBe(6_000_000);
  });
});

describe("computeQuote: reserve 3 % or 5 % (memory and SSD share)", () => {
  const withMemory = (memory: number, rest: number) => [
    pcLine(memory, { key: "ram", isRamOrSsd: true }),
    pcLine(rest, { key: "rest" }),
  ];
  it("25 % and more of the purchased lines -> 5 %", () => {
    const q = computeQuote(withMemory(2_500_000, 7_500_000), D, ctx());
    expect(q.reserveBp).toBe(500);
    expect(q.reserveSum).toBe(500_000);
    expect(q.warnings).toEqual([{ key: "quote.reserve_high", params: { shareBp: 2500 } }]);
  });
  it("just below 25 % -> 3 %", () => {
    const q = computeQuote(withMemory(2_499_999, 7_500_001), D, ctx());
    expect(q.reserveBp).toBe(300);
    expect(q.warnings).toEqual([]);
  });
  it("memory bought by the client or owned by the client does not count", () => {
    const q = computeQuote(
      [
        pcLine(2_500_000, { key: "ram", isRamOrSsd: true, customerOwned: true, purchasedByIp: false }),
        pcLine(7_500_000),
      ],
      D,
      ctx(),
    );
    expect(q.reserveBp).toBe(300);
  });
  it("follows the configured percentages", () => {
    const s: FeeSettings = { ...D, reserveBp: bp(200), reserveHighBp: bp(400), reserveHighShareBp: bp(5000) };
    expect(computeQuote(withMemory(5_000_000, 5_000_000), s, ctx()).reserveBp).toBe(400);
    expect(computeQuote(withMemory(4_000_000, 6_000_000), s, ctx()).reserveBp).toBe(200);
  });
});

describe("computeQuote: eligibility for full cycle", () => {
  const mode = (base: number, c: Partial<QuoteContext> = {}) => computeQuote([pcLine(base)], D, ctx(c)).eligibility;
  it("PC from 6.7 mln is a full cycle", () => {
    expect(mode(6_700_000)).toEqual({ mode: "full_cycle" });
    expect(mode(60_000_000)).toEqual({ mode: "full_cycle" });
  });
  it("PC from 4.5 to 6.7 mln only in a free window", () => {
    expect(mode(6_699_999, { freeWindowAvailable: true })).toEqual({
      mode: "free_window_only",
      minEstimate: 4_500_000,
    });
    expect(mode(4_500_000, { freeWindowAvailable: true })).toEqual({
      mode: "free_window_only",
      minEstimate: 4_500_000,
    });
  });
  it("without a free window the middle band falls back to Podbor", () => {
    const q = computeQuote([pcLine(5_000_000)], D, ctx({ freeWindowAvailable: false }));
    expect(q.eligibility).toEqual({ mode: "podbor_only", reason: "below_min" });
    expect(q.warnings).toEqual([{ key: "quote.free_window_unavailable" }]);
  });
  it("below 4.5 mln is Podbor even with a free window", () => {
    expect(mode(4_499_999, { freeWindowAvailable: true })).toEqual({ mode: "podbor_only", reason: "below_min" });
  });
  it("setup with mounting from 13.3 mln", () => {
    const setup = (base: number) =>
      computeQuote(
        [pcLine(base - 1_000_000), line({ group: "mount", unitSum: 1_000_000 })],
        D,
        ctx({ kind: "setup", freeWindowAvailable: true }),
      ).eligibility;
    expect(setup(13_300_000)).toEqual({ mode: "full_cycle" });
    expect(setup(13_299_999)).toEqual({ mode: "setup_below_min" });
  });
  it("the minimum is checked against the fee base, not the limit with the reserve", () => {
    // 6 650 000 of components + licences must not reach 6.7 mln
    const q = computeQuote(
      [pcLine(6_650_000), line({ key: "lic", group: "outside_scale", unitSum: 500_000 })],
      D,
      ctx({ freeWindowAvailable: true }),
    );
    expect(q.eligibility.mode).toBe("free_window_only");
  });
});

describe("computeQuote: estimate validity period", () => {
  const confirmed = (lines: QuoteLineInput[]) => computeQuote(lines, D, ctx({ confirmed: true })).validUntil;
  const furniture = (key: string) => line({ key, group: "mount", unitSum: 1_000_000, isFurnitureLike: true });
  it("24 hours for components", () => {
    expect(confirmed([pcLine(10_000_000)])?.toISOString()).toBe("2026-10-07T07:00:00.000Z");
  });
  it("72 hours only if every line is furniture, light, decor or acoustics", () => {
    expect(confirmed([furniture("desk"), furniture("lamp")])?.toISOString()).toBe("2026-10-09T07:00:00.000Z");
  });
  it("a single component line brings it back to 24 hours", () => {
    expect(confirmed([furniture("desk"), pcLine(1_000_000)])?.toISOString()).toBe("2026-10-07T07:00:00.000Z");
  });
  it("customer-owned lines do not set the period", () => {
    const owned = pcLine(1_000_000, { key: "own", customerOwned: true, purchasedByIp: false });
    expect(confirmed([furniture("desk"), owned])?.toISOString()).toBe("2026-10-09T07:00:00.000Z");
  });
  it("24 hours for an empty estimate, and no period when not confirmed", () => {
    expect(confirmed([])?.toISOString()).toBe("2026-10-07T07:00:00.000Z");
    expect(computeQuote([pcLine(10_000_000)], D, ctx({ confirmed: false })).validUntil).toBeUndefined();
  });
  it("follows the configured hours and does not mutate the input date", () => {
    const now = new Date(NOW);
    const s: FeeSettings = { ...D, shelfLifeHours: { components: 12, furniture: 48 } };
    const q = computeQuote([pcLine(10_000_000)], s, ctx({ now, confirmed: true }));
    expect(q.validUntil?.toISOString()).toBe("2026-10-06T19:00:00.000Z");
    expect(now.getTime()).toBe(NOW.getTime());
  });
});

describe("computeQuote: properties", () => {
  it("advance + final = fee, grand total = limit + fee, limit >= bought lines", () => {
    forAll((g) => {
      const lines = Array.from({ length: g.int(1, 8) }, (_, i) =>
        line({
          key: `k${i}`,
          group: g.pick(["pc", "mount", "outside_scale"] as const),
          qty: g.int(0, 3),
          unitSum: g.int(0, 20_000_000),
          isRamOrSsd: g.bool(),
          customerOwned: g.int(0, 5) === 0,
          purchasedByIp: g.bool(),
        }),
      );
      const q = computeQuote(lines, D, ctx({ complexBuild: g.bool(), freeWindowAvailable: g.bool() }));
      expect(q.advance + q.final).toBe(q.fee.total);
      expect(q.grandTotal).toBe(q.purchaseLimit + q.fee.total);
      expect(q.reserveSum % 10_000).toBe(0);
      expect(q.purchaseLimit).toBeGreaterThanOrEqual(q.reserveSum);
    });
  });
});

describe("partsBudgetFromTotal: client budget -> parts", () => {
  const total = (parts: number, reserve: number) => {
    const q = computeQuote([pcLine(parts)], D, ctx());
    expect(q.reserveBp).toBe(reserve);
    return q.grandTotal;
  };
  it("inverts the quote on the 15 % branch", () => {
    expect(partsBudgetFromTotal(total(10_000_000, 300), D, bp(300))).toBe(10_000_000);
  });
  it("inverts the quote on the 10 % branch with the 3 mln minimum", () => {
    expect(partsBudgetFromTotal(total(30_000_000, 300), D, bp(300))).toBe(30_000_000);
    expect(partsBudgetFromTotal(total(22_000_000, 300), D, bp(300))).toBe(22_000_000);
  });
  it("takes the consistent branch around 20 mln", () => {
    const parts = 19_999_999;
    expect(partsBudgetFromTotal(total(parts, 300), D, bp(300))).toBe(parts);
    expect(partsBudgetFromTotal(total(20_000_000, 300), D, bp(300))).toBe(20_000_000);
  });
  it("uses the given reserve rate", () => {
    const parts = 8_000_000;
    const q = computeQuote([pcLine(1_600_000, { key: "r", isRamOrSsd: true }), pcLine(6_400_000)], D, ctx()); // 20 % memory -> 3 %
    expect(partsBudgetFromTotal(q.grandTotal, D, bp(300))).toBe(parts);
    expect(partsBudgetFromTotal(S(q.grandTotal), D, bp(500))).toBeLessThan(parts);
  });
  it("is zero for a zero or too small budget", () => {
    expect(partsBudgetFromTotal(S(0), D, bp(300))).toBe(0);
    expect(partsBudgetFromTotal(S(1), D, bp(300))).toBe(0); // any purchase carries a 10 000 reserve
    expect(partsBudgetFromTotal(S(10_001), D, bp(300))).toBe(1);
  });
  it("rejects a negative budget", () => {
    expect(() => partsBudgetFromTotal(S(-1), D, bp(300))).toThrow(RangeError);
  });

  it("property: the largest parts whose quote does not exceed the budget", () => {
    forAll(
      (g) => {
        const budget = S(g.int(0, 200_000_000));
        const reserve: Bp = g.pick([bp(300), bp(500), bp(0)]);
        const parts = partsBudgetFromTotal(budget, D, reserve);
        const cost = (p: number) => {
          if (p === 0) return 0;
          const fee = computeFee([pcLine(p)], D, { complexBuild: false }).total;
          const res = Math.ceil((p * reserve) / (10_000 * D.reserveRoundStep)) * D.reserveRoundStep;
          return p + fee + res;
        };
        expect(cost(parts)).toBeLessThanOrEqual(budget);
        expect(cost(parts + 1)).toBeGreaterThan(budget);
      },
      { runs: 300 },
    );
  });
});
