// WP-00, ADR-007 item 4: the ledger effects of the order are built by the functions of WP-01 (reserve/index.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bp, type Sum } from "../money/index.ts";
import { taxRiskReserve, warrantyReserveContribution } from "../reserve/index.ts";
import type { WarrantyReserveState } from "../threshold/types.ts";
import { transition } from "./index.ts";
import { CAL, EVENTS, NOW, order, SETTINGS, sum } from "./testkit.ts";
import type { Effect, OrderSnapshot } from "./types.ts";

type Ledger = Extract<Effect, { kind: "ledger" }>;
const state = (balance: number, closedOrders: number, losses = 0): WarrantyReserveState => ({
  balance: sum(balance),
  closedOrders,
  lossesLast12mBp: bp(losses),
});

const STATES: [string, WarrantyReserveState][] = [
  ["empty fund", state(0, 0)],
  ["balance just below 10 mln", state(9_999_999, 40)],
  ["29 closed orders", state(20_000_000, 29)],
  ["mature", state(10_000_000, 30)],
  ["mature, losses 49 bp", state(25_000_000, 80, 49)],
  ["mature, losses 50 bp", state(25_000_000, 80, 50)],
];
const RECEIPTS = [
  0, 1, 99, 100, 3_000_000, 5_000_000, 7_500_000, 7_500_001, 7_550_000, 9_000_000, 12_345_678, 100_000_000,
];

/** Ledger effects of a settled report (tax reserve) and of a handover (warranty reserve) for one set of inputs. */
function ledgers(receipts: number, reserves: OrderSnapshot["reserves"]): { tax: Ledger[]; warranty: Ledger[] } {
  const money = { fundsReceived: sum(receipts), receiptsTotal: sum(receipts), refunded: sum(0) };
  const settle = transition(
    order({ status: "report_sent", report: { accepted: true }, money, reserves }),
    EVENTS.REMAINDER_SETTLED,
    "owner",
    NOW,
    CAL,
    SETTINGS,
  );
  const handover = transition(
    order({ status: "delivering", money, reserves }),
    EVENTS.HANDOVER,
    "owner",
    NOW,
    CAL,
    SETTINGS,
  );
  if (!settle.ok || !handover.ok) throw new Error("expected both transitions to pass");
  const only = (effects: Effect[], fund: Ledger["fund"]): Ledger[] =>
    effects.filter((e): e is Ledger => e.kind === "ledger" && e.fund === fund);
  return { tax: only(settle.effects, "tax_risk"), warranty: only(handover.effects, "warranty") };
}
const asEffects = (fund: Ledger["fund"], amount: Sum): Ledger[] =>
  amount > 0 ? [{ kind: "ledger", fund, amount }] : [];

describe("order and reserve give one result on the same inputs", () => {
  const rows = STATES.flatMap(([name, st]) =>
    RECEIPTS.flatMap((r) =>
      [true, false].map(
        (active) => [`${name}, receipts ${String(r)}, tax reserve active ${String(active)}`, st, r, active] as const,
      ),
    ),
  );

  it.each(rows)("%s", (_label, st, receipts, active) => {
    const got = ledgers(receipts, { warranty: st, taxRiskActive: active });
    expect(got.warranty).toEqual(asEffects("warranty", warrantyReserveContribution(sum(receipts), st)));
    expect(got.tax).toEqual(asEffects("tax_risk", taxRiskReserve(sum(receipts), active)));
  });

  it("the same holds for any receipts and any fund state (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000_000 }),
        fc.record({
          balance: fc.integer({ min: 0, max: 50_000_000 }),
          closedOrders: fc.integer({ min: 0, max: 100 }),
          losses: fc.integer({ min: 0, max: 200 }),
        }),
        fc.boolean(),
        (receipts, s, active) => {
          const st = state(s.balance, s.closedOrders, s.losses);
          const got = ledgers(receipts, { warranty: st, taxRiskActive: active });
          expect(got.warranty).toEqual(asEffects("warranty", warrantyReserveContribution(sum(receipts), st)));
          expect(got.tax).toEqual(asEffects("tax_risk", taxRiskReserve(sum(receipts), active)));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("reserve rules as decided (DECISIONS R-7, R-12) seen through the order", () => {
  it("rounds up: the reserve is the owner's protective fund (integrator decision of 06.10)", () => {
    expect(ledgers(1_234_599, { warranty: state(0, 0), taxRiskActive: true }).tax).toEqual([
      { kind: "ledger", fund: "tax_risk", amount: 12_346 },
    ]);
    expect(ledgers(7_500_001, { warranty: state(0, 0), taxRiskActive: true }).warranty).toEqual([
      { kind: "ledger", fund: "warranty", amount: 150_001 },
    ]);
  });

  it("starting stage: 2 % but not less than 150 000; mature stage: 1 % without a minimum", () => {
    const early = ledgers(5_000_000, { warranty: state(0, 0), taxRiskActive: true });
    expect(early.warranty).toEqual([{ kind: "ledger", fund: "warranty", amount: 150_000 }]);
    const mature = ledgers(5_000_000, { warranty: state(10_000_000, 30), taxRiskActive: true });
    expect(mature.warranty).toEqual([{ kind: "ledger", fund: "warranty", amount: 50_000 }]);
  });

  it("heavy losses of the last 12 months return the warranty reserve to 2 %", () => {
    const got = ledgers(5_000_000, { warranty: state(10_000_000, 30, 50), taxRiskActive: true });
    expect(got.warranty).toEqual([{ kind: "ledger", fund: "warranty", amount: 150_000 }]);
  });

  it("an answer of the tax authority stops the tax reserve, the warranty reserve goes on", () => {
    const got = ledgers(9_000_000, { warranty: state(0, 0), taxRiskActive: false });
    expect(got.tax).toEqual([]);
    expect(got.warranty).toEqual([{ kind: "ledger", fund: "warranty", amount: 180_000 }]);
  });

  it("an order without receipts reserves nothing (the 150 000 minimum applies to components only)", () => {
    const got = ledgers(0, { warranty: state(0, 0), taxRiskActive: true });
    expect(got).toEqual({ tax: [], warranty: [] });
  });

  it("a snapshot without the reserve inputs is a bug and fails loudly, not with a guessed amount", () => {
    const broken = order({ status: "delivering" }) as Partial<OrderSnapshot>;
    delete broken.reserves;
    expect(() => transition(broken as OrderSnapshot, EVENTS.HANDOVER, "owner", NOW, CAL, SETTINGS)).toThrow(RangeError);
    const settling = order({ status: "report_sent", report: { accepted: true } }) as Partial<OrderSnapshot>;
    delete settling.reserves;
    expect(() => transition(settling as OrderSnapshot, EVENTS.REMAINDER_SETTLED, "owner", NOW, CAL, SETTINGS)).toThrow(
      RangeError,
    );
  });

  it("does not touch the snapshot", () => {
    const o = order({ status: "delivering", reserves: { warranty: { balance: sum(10_000_000), closedOrders: 30 } } });
    const before = JSON.stringify(o);
    transition(o, EVENTS.HANDOVER, "owner", NOW, CAL, SETTINGS);
    expect(JSON.stringify(o)).toBe(before);
  });
});
