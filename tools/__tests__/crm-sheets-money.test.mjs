// The money functions of the Apps Script project against packages/domain on a table of cases.
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeFee,
  computeQuote,
  partsBudgetFromTotal,
  podborFee,
  DEFAULT_FEE_SETTINGS as S,
} from "../../packages/domain/src/fee/index.ts";
import { bp, sum } from "../../packages/domain/src/money/index.ts";
import { evalIn, loadSources } from "../crm-sheets/scripts/load.mjs";

let ctx;
let s;
beforeAll(() => {
  ctx = loadSources();
  s = JSON.parse(evalIn(ctx, "JSON.stringify(NV_DEFAULTS)"));
});
const call = (fn, ...args) => {
  ctx.__args = args;
  return JSON.parse(evalIn(ctx, `JSON.stringify(${fn}(...__args))`) ?? "null");
};

const line = (key, group, unitSum, o = {}) => ({
  key,
  group,
  qty: 1,
  unitSum: sum(unitSum),
  isRamOrSsd: false,
  isFurnitureLike: false,
  customerOwned: false,
  purchasedByIp: true,
  ...o,
});
const ctxQ = {
  now: new Date("2026-10-06T10:00:00+05:00"),
  kind: "pc",
  complexBuild: false,
  freeWindowAvailable: false,
  confirmed: false,
};

describe("fee scale (computeFee)", () => {
  it.each([
    [5_000_000, 750_000],
    [10_000_000, 1_500_000],
    [15_000_000, 2_250_000],
    [19_999_999, 2_999_999],
    [20_000_000, 3_000_000],
    [25_000_000, 3_000_000],
    [40_000_000, 4_000_000],
    [60_000_000, 6_000_000],
  ])("PC base %i gives fee %i", (base, expected) => {
    expect(call("nvComputeFee", { basePc: base }, s).total).toBe(expected);
    expect(computeFee([line("a", "pc", base)], S, { complexBuild: false }).total).toBe(expected);
  });

  it("setup 17.5 + 7.5 mln gives 3 750 000", () => {
    const r = call("nvComputeFee", { basePc: 17_500_000, baseMount: 7_500_000 }, s);
    expect(r.total).toBe(3_750_000);
  });

  it("matches the domain on 3000 pseudo-random bases including the edges", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const edges = [
      0, 1, 999, 19_999_999, 20_000_000, 20_000_001, 29_999_999, 30_000_000, 30_000_001, 1_000_000_000_000,
    ];
    const bases = [...edges];
    for (let i = 0; i < 3000; i++) bases.push(Math.floor(rnd() ** 3 * 100_000_000));
    for (const basePc of bases) {
      const baseMount = Math.floor(rnd() * 20_000_000);
      for (const complex of [false, true]) {
        const mine = call("nvComputeFee", { basePc, baseMount, complex }, s);
        const lines = [line("p", "pc", basePc), line("m", "mount", baseMount)];
        const dom = computeFee(lines, S, { complexBuild: complex });
        expect(mine.total).toBe(dom.total);
        expect(mine.rateBp).toBe(dom.effectiveRateBp);
        expect(mine.commission).toBe(dom.commissionLine);
        expect(mine.works).toBe(dom.worksLine);
        expect(mine.commission + mine.works).toBe(mine.total);
      }
    }
  });
});

describe("estimate (computeQuote)", () => {
  it("matches the domain: reserve, limit, advance, final, grand total, podbor", () => {
    let seed = 777;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 1500; i++) {
      const pc = Math.floor(rnd() * 70_000_000);
      const mount = rnd() < 0.3 ? Math.floor(rnd() * 15_000_000) : 0;
      const outside = rnd() < 0.3 ? Math.floor(rnd() * 3_000_000) : 0;
      const ramShare = rnd();
      const mem = Math.floor((pc + mount) * ramShare * 0.5);
      const kind = mount > 0 && rnd() < 0.5 ? "Сетап" : "ПК";
      const lines = [
        line("pc", "pc", pc - Math.min(mem, pc)),
        line("mem", "pc", Math.min(mem, pc), { isRamOrSsd: true }),
        line("mount", "mount", mount),
        line("out", "outside_scale", outside),
      ];
      const purchased = pc + mount + outside;
      const mine = call(
        "nvComputeQuote",
        {
          kind,
          basePc: pc,
          baseMount: mount,
          outside,
          purchased,
          memory: Math.min(mem, pc),
          complex: false,
          freeWindow: false,
        },
        s,
      );
      const dom = computeQuote(lines, S, { ...ctxQ, kind: kind === "Сетап" ? "setup" : "pc" });
      expect(mine.feeTotal).toBe(dom.fee.total);
      expect(mine.reserveBp).toBe(dom.reserveBp);
      expect(mine.reserveSum).toBe(dom.reserveSum);
      expect(mine.purchaseLimit).toBe(dom.purchaseLimit);
      expect(mine.advance).toBe(dom.advance);
      expect(mine.final).toBe(dom.final);
      expect(mine.grandTotal).toBe(dom.grandTotal);
      expect(mine.advance + mine.final).toBe(mine.feeTotal);
      expect(mine.podborFee).toBe(podborFee(dom.fee, S));
      const mode = dom.eligibility.mode;
      const label = mine.eligibility;
      if (mode === "full_cycle") expect(label).toBe("Полный цикл");
      if (mode === "setup_below_min") expect(label).toBe("Сетап ниже минимума");
      if (mode === "podbor_only") expect(label.startsWith("Только")).toBe(true);
    }
  });

  it("the 5 % reserve starts at 25 % memory and SSD", () => {
    const r1 = call("nvComputeQuote", { kind: "ПК", basePc: 10_000_000, purchased: 10_000_000, memory: 2_499_999 }, s);
    const r2 = call("nvComputeQuote", { kind: "ПК", basePc: 10_000_000, purchased: 10_000_000, memory: 2_500_000 }, s);
    expect(r1.reserveBp).toBe(300);
    expect(r1.reserveSum).toBe(300_000);
    expect(r2.reserveBp).toBe(500);
    expect(r2.reserveSum).toBe(500_000);
  });

  it("reserve rounds up to a whole sum and then to 10 000", () => {
    const r = call("nvComputeQuote", { kind: "ПК", basePc: 7_000_001, purchased: 7_000_001, memory: 0 }, s);
    expect(r.reserveSum).toBe(220_000); // ceil(210 000.03) = 210 001 -> 220 000
  });
});

describe("budget inversion (partsBudgetFromTotal)", () => {
  it("is the domain result for a grid of budgets and always re-quotes within the budget", () => {
    const budgets = [
      0, 1, 4_000_000, 5_000_000, 6_700_000, 10_000_000, 17_345_678, 25_000_000, 40_000_000, 99_999_999, 250_000_000,
    ];
    for (const total of budgets) {
      for (const reserveBp of [300, 500]) {
        const mine = call("nvPartsFromBudget", total, s, reserveBp);
        expect(mine).toBe(partsBudgetFromTotal(sum(total), S, bp(reserveBp)));
      }
    }
  });
  it("rejects a budget above the limit", () => {
    expect(() => call("nvPartsFromBudget", 1_000_000_000_001, s, 300)).toThrow();
  });
});
