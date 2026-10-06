import { describe, expect, it } from "vitest";
import { transition } from "./index.ts";
import {
  CAL,
  DAY,
  EVENTS,
  HOUR,
  NOW,
  type OrderPatch,
  order,
  POINT_OF,
  SETTINGS,
  SETTLEMENT,
  sum,
  tk,
} from "./testkit.ts";
import type { Actor, Effect, OrderEvent } from "./types.ts";

function effectsOf(patch: OrderPatch, event: OrderEvent, actor: Actor, now: Date = NOW, settings = SETTINGS): Effect[] {
  const r = transition(order(patch), event, actor, now, CAL, settings);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.effects;
}
const at = (ms: number): Date => new Date(ms);
const FUNDS = { fundsReceived: sum(10_300_000), receiptsTotal: sum(9_000_000) };

describe("effects of SEND_ESTIMATE", () => {
  it("PDF without a watermark, notification, expiry at validUntil", () => {
    expect(effectsOf({ status: "estimate_draft" }, EVENTS.SEND_ESTIMATE, "owner")).toEqual([
      { kind: "render_pdf", doc: "quote", watermarkDraft: false },
      { kind: "notify", to: "customer", templateKey: "order.estimate_sent" },
      { kind: "schedule", job: "estimate_expiry", at: at(NOW.getTime() + DAY) },
    ]);
  });

  it.each([
    ["Uzbek offer is a stub", { uz: "stub" as const }],
    ["Russian offer only approved", { ru: "lawyer_approved" as const }],
  ])("watermark 'not an offer' when %s", (_name, offer) => {
    const effects = effectsOf({ status: "estimate_draft", offer }, EVENTS.SEND_ESTIMATE, "owner");
    expect(effects[0]).toEqual({ kind: "render_pdf", doc: "quote", watermarkDraft: true });
  });

  it("a 72 h validUntil (furniture, light, decor) is scheduled as is", () => {
    const validUntil = at(NOW.getTime() + 72 * HOUR);
    const effects = effectsOf({ status: "estimate_draft", quote: { validUntil } }, EVENTS.SEND_ESTIMATE, "owner");
    expect(effects.at(-1)).toEqual({ kind: "schedule", job: "estimate_expiry", at: validUntil });
  });
});

describe("effects of the estimate and acceptance", () => {
  it("EXPIRE tells the customer that prices may have changed", () => {
    const effects = effectsOf(
      { status: "estimate_sent", quote: { validUntil: at(NOW.getTime() - 1) } },
      EVENTS.EXPIRE,
      "system",
    );
    expect(effects).toEqual([{ kind: "notify", to: "customer", templateKey: "order.estimate_expired" }]);
  });

  it("REVISE has no effects (a new quote version is made by the service)", () => {
    expect(effectsOf({ status: "estimate_expired" }, EVENTS.REVISE, "owner")).toEqual([]);
  });

  it("ACCEPT expects the advance and the purchase funds and shows the payment screen", () => {
    expect(effectsOf({ status: "estimate_sent" }, EVENTS.ACCEPT, "customer")).toEqual([
      { kind: "expect_payment", paymentKind: "fee_advance", amount: 900_000 },
      { kind: "expect_payment", paymentKind: "purchase_funds", amount: 10_300_000 },
      { kind: "notify", to: "customer", templateKey: "order.accepted" },
    ]);
  });

  it("ACCEPT skips an expectation of zero", () => {
    const effects = effectsOf(
      { status: "estimate_sent", quote: { advance: sum(0), purchaseLimit: sum(0) } },
      EVENTS.ACCEPT,
      "customer",
    );
    expect(effects).toEqual([{ kind: "notify", to: "customer", templateKey: "order.accepted" }]);
  });
});

describe("effects of the accepted stage", () => {
  it("FEE_PREPAID and MEETING_DONE only set flags", () => {
    expect(effectsOf({ status: "accepted" }, EVENTS.FEE_PREPAID, "owner")).toEqual([]);
    expect(effectsOf({ status: "accepted" }, EVENTS.MEETING_DONE, "owner")).toEqual([]);
  });

  it.each([
    ["Tuesday 11:00", "2026-10-06T11:00:00", "2026-10-07T10:00:00"],
    ["Friday 20:00 goes to Saturday", "2026-10-09T20:00:00", "2026-10-10T10:00:00"],
    ["Saturday goes over Sunday to Monday", "2026-10-10T15:00:00", "2026-10-12T10:00:00"],
    ["Monday goes over the Tuesday holiday", "2026-10-12T15:00:00", "2026-10-14T10:00:00"],
  ])("FUNDS_RECEIVED %s sets purchaseNotBefore to the next working day start", (_name, receivedAt, expected) => {
    const event: OrderEvent = { type: "FUNDS_RECEIVED", paymentIds: ["p2"], receivedAt: tk(receivedAt) };
    const effects = effectsOf({ status: "accepted", money: { fundsReceived: sum(10_300_000) } }, event, "owner");
    expect(effects).toEqual([{ kind: "set", field: "purchaseNotBefore", at: tk(expected) }]);
  });

  it("START_PURCHASE has no effects", () => {
    const patch: OrderPatch = {
      status: "accepted",
      flags: { feePrepaid: true, fundsReceived: true },
      purchaseNotBefore: NOW,
    };
    expect(effectsOf(patch, EVENTS.START_PURCHASE, "owner")).toEqual([]);
  });
});

describe("effects of purchasing and the report", () => {
  it("PURCHASE_RECORDED sends the receipt photo to the customer", () => {
    expect(effectsOf({ status: "purchasing", money: FUNDS }, EVENTS.PURCHASE_RECORDED, "assistant")).toEqual([
      { kind: "notify", to: "customer", templateKey: "order.purchase_recorded" },
    ]);
  });

  it("PURCHASE_DONE sets reportDueAt to +24 h and schedules the target and the 48 h deadline", () => {
    expect(effectsOf({ status: "purchasing", purchasesComplete: true }, EVENTS.PURCHASE_DONE, "owner")).toEqual([
      { kind: "set", field: "reportDueAt", at: at(NOW.getTime() + 24 * HOUR) },
      { kind: "schedule", job: "report_due", at: at(NOW.getTime() + 24 * HOUR) },
      { kind: "schedule", job: "report_due", at: at(NOW.getTime() + 48 * HOUR) },
    ]);
  });

  it("SEND_REPORT: PDF, 3 working days for objections, 5 for the refund, remainder expected", () => {
    const effects = effectsOf(
      { status: "report_due", purchasesComplete: true, money: FUNDS },
      EVENTS.SEND_REPORT,
      "owner",
    );
    // Tuesday 12:00 + 3 working days = Friday; + 5 = Monday (Saturday counts, Sunday does not).
    const objectionUntil = tk("2026-10-09T12:00:00");
    const refundDueAt = tk("2026-10-12T12:00:00");
    expect(effects).toEqual([
      { kind: "render_pdf", doc: "commission_report", watermarkDraft: false },
      { kind: "set", field: "objectionUntil", at: objectionUntil },
      { kind: "set", field: "refundDueAt", at: refundDueAt },
      { kind: "schedule", job: "objection_window", at: objectionUntil },
      { kind: "schedule", job: "refund_due", at: refundDueAt },
      { kind: "expect_payment", paymentKind: "remainder_refund", amount: 1_300_000 },
      { kind: "notify", to: "customer", templateKey: "order.report_sent" },
    ]);
  });

  it("SEND_REPORT on Friday afternoon: the objection window crosses Saturday, Sunday and the holiday", () => {
    const friday = tk("2026-10-09T15:00:00");
    const effects = effectsOf(
      { status: "report_due", purchasesComplete: true, money: FUNDS },
      EVENTS.SEND_REPORT,
      "owner",
      friday,
    );
    // Sat(1), Mon(2), Tue 13th is a holiday, Wed 14th(3); refund: ..., Thu(4), Fri 16th(5).
    expect(effects).toContainEqual({ kind: "set", field: "objectionUntil", at: tk("2026-10-14T15:00:00") });
    expect(effects).toContainEqual({ kind: "set", field: "refundDueAt", at: tk("2026-10-16T15:00:00") });
  });

  it("SEND_REPORT expects no refund when everything was spent or already returned", () => {
    const spent = effectsOf(
      {
        status: "report_due",
        purchasesComplete: true,
        money: { fundsReceived: sum(9_000_000), receiptsTotal: sum(9_000_000) },
      },
      EVENTS.SEND_REPORT,
      "owner",
    );
    expect(spent.some((e) => e.kind === "expect_payment")).toBe(false);
    const returned = effectsOf(
      { status: "report_due", purchasesComplete: true, money: { ...FUNDS, refunded: sum(1_300_000) } },
      EVENTS.SEND_REPORT,
      "owner",
    );
    expect(returned.some((e) => e.kind === "expect_payment")).toBe(false);
  });

  it("OBJECTION opens a topic for the owner", () => {
    expect(effectsOf({ status: "report_sent", report: {} }, EVENTS.OBJECTION, "customer")).toEqual([
      { kind: "notify", to: "owner_topic", templateKey: "order.report_objection" },
    ]);
  });

  it("report acceptance has no effects", () => {
    expect(effectsOf({ status: "report_sent", report: {} }, EVENTS.REPORT_ACCEPTED, "customer")).toEqual([]);
    const windowClosed = { status: "report_sent", report: { objectionUntil: at(NOW.getTime() - 1) } } as const;
    expect(effectsOf(windowClosed, EVENTS.REPORT_DEEMED_ACCEPTED, "system")).toEqual([]);
  });
});

describe("effects of settlement, assembly and handover", () => {
  const settled: OrderPatch = {
    status: "report_sent",
    report: { accepted: true },
    money: { ...FUNDS, refunded: sum(1_300_000) },
  };

  it("REMAINDER_SETTLED moves 1 % of the receipts to the tax risk reserve (rounded up, as in WP-01)", () => {
    expect(effectsOf(settled, EVENTS.REMAINDER_SETTLED, "owner")).toEqual([
      { kind: "ledger", fund: "tax_risk", amount: 90_000 },
    ]);
    const odd = {
      ...settled,
      money: { fundsReceived: sum(1_234_599), receiptsTotal: sum(1_234_599), refunded: sum(0) },
    };
    expect(effectsOf(odd, { type: "REMAINDER_SETTLED" }, "owner")).toEqual([
      { kind: "ledger", fund: "tax_risk", amount: 12_346 },
    ]);
  });

  it("REMAINDER_SETTLED with no receipts moves nothing", () => {
    const none = { ...settled, money: { fundsReceived: sum(0), receiptsTotal: sum(0), refunded: sum(0) } };
    expect(effectsOf(none, { type: "REMAINDER_SETTLED" }, "owner")).toEqual([]);
  });

  it("MATERIALS_ACCEPTED has no effects", () => {
    expect(effectsOf({ status: "settled" }, EVENTS.MATERIALS_ACCEPTED, "owner")).toEqual([]);
  });

  it("ASSEMBLED sends stage photos", () => {
    expect(effectsOf({ status: "assembling" }, EVENTS.ASSEMBLED, "assistant")).toEqual([
      { kind: "notify", to: "customer", templateKey: "order.assembly_photos" },
    ]);
  });

  it("TESTS_PASSED renders the passport and tells the customer", () => {
    expect(effectsOf({ status: "testing" }, EVENTS.TESTS_PASSED, "owner")).toEqual([
      { kind: "render_pdf", doc: "passport", watermarkDraft: false },
      { kind: "notify", to: "customer", templateKey: "order.ready" },
    ]);
  });

  it("DISPATCH tells the customer the delivery is on its way", () => {
    expect(effectsOf({ status: "ready" }, EVENTS.DISPATCH, "owner")).toEqual([
      { kind: "notify", to: "customer", templateKey: "order.delivering" },
    ]);
  });

  it("HANDOVER: 12 months of warranty, aftercare at 7 and 30 days, warranty reserve", () => {
    const effects = effectsOf({ status: "delivering", money: FUNDS }, EVENTS.HANDOVER, "owner");
    const warrantyUntil = tk("2027-10-06T12:00:00");
    expect(effects).toEqual([
      { kind: "set", field: "warrantyUntil", at: warrantyUntil },
      { kind: "schedule", job: "warranty_end", at: warrantyUntil },
      { kind: "schedule", job: "aftercare", at: at(NOW.getTime() + 7 * DAY) },
      { kind: "schedule", job: "aftercare", at: at(NOW.getTime() + 30 * DAY) },
      { kind: "ledger", fund: "warranty", amount: 180_000 },
      { kind: "notify", to: "customer", templateKey: "order.handed_over" },
    ]);
  });

  it.each([
    [5_000_000, 150_000],
    [7_500_000, 150_000],
    [7_500_001, 150_001],
    [7_550_000, 151_000],
    [100_000_000, 2_000_000],
    [12_345_678, 246_914],
  ])("HANDOVER warranty reserve for receipts %s is %s (2 %%, at least 150 000, rounded up)", (receipts, expected) => {
    const effects = effectsOf(
      { status: "delivering", money: { fundsReceived: sum(receipts), receiptsTotal: sum(receipts) } },
      EVENTS.HANDOVER,
      "customer",
    );
    expect(effects).toContainEqual({ kind: "ledger", fund: "warranty", amount: expected });
  });

  it("HANDOVER of an order without receipts has nothing to reserve", () => {
    const effects = effectsOf(
      { status: "delivering", money: { fundsReceived: sum(0), receiptsTotal: sum(0) } },
      EVENTS.HANDOVER,
      "owner",
    );
    expect(effects.some((e) => e.kind === "ledger")).toBe(false);
  });

  it("HANDOVER on a leap day keeps the last day of the shorter month", () => {
    const effects = effectsOf({ status: "delivering" }, EVENTS.HANDOVER, "owner", tk("2028-02-29T10:00:00"));
    expect(effects[0]).toEqual({ kind: "set", field: "warrantyUntil", at: tk("2029-02-28T10:00:00") });
  });

  it("CLOSE has no effects", () => {
    expect(effectsOf({ status: "handed_over" }, EVENTS.CLOSE, "system")).toEqual([]);
  });
});

describe("effects of PODBOR_DELIVERED", () => {
  it("sets podborCreditUntil = delivery + podborCreditDays (WP-00, ADR-007 item 2)", () => {
    expect(effectsOf({ status: "estimate_sent", kind: "podbor" }, EVENTS.PODBOR_DELIVERED, "owner")).toEqual([
      { kind: "set", field: "podborCreditUntil", at: at(NOW.getTime() + 30 * DAY) },
      { kind: "notify", to: "customer", templateKey: "order.podbor_delivered" },
    ]);
  });

  it("emits no aftercare job: the credit term must not look like an after-sale task", () => {
    const effects = effectsOf({ status: "estimate_sent", kind: "podbor" }, EVENTS.PODBOR_DELIVERED, "owner");
    expect(effects.filter((e) => e.kind === "schedule")).toEqual([]);
  });

  it("the credit term comes from the settings", () => {
    const settings = { ...SETTINGS, podborCreditDays: 14 };
    const effects = effectsOf(
      { status: "estimate_sent", kind: "podbor" },
      EVENTS.PODBOR_DELIVERED,
      "owner",
      NOW,
      settings,
    );
    expect(effects[0]).toEqual({ kind: "set", field: "podborCreditUntil", at: at(NOW.getTime() + 14 * DAY) });
  });

  it("a zero-day term ends at the moment of delivery", () => {
    const effects = effectsOf({ status: "estimate_sent", kind: "podbor" }, EVENTS.PODBOR_DELIVERED, "owner", NOW, {
      ...SETTINGS,
      podborCreditDays: 0,
    });
    expect(effects[0]).toEqual({ kind: "set", field: "podborCreditUntil", at: at(NOW.getTime()) });
  });

  it("counts from the delivery instant, not from the clock of another event", () => {
    const later = tk("2026-11-30T23:30:00");
    const effects = effectsOf({ status: "estimate_sent", kind: "podbor" }, EVENTS.PODBOR_DELIVERED, "owner", later);
    expect(effects[0]).toEqual({ kind: "set", field: "podborCreditUntil", at: tk("2026-12-30T23:30:00") });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e12])(
    "refuses a broken podborCreditDays %s instead of emitting an invalid date",
    (days) => {
      expect(() =>
        transition(order({ status: "estimate_sent", kind: "podbor" }), EVENTS.PODBOR_DELIVERED, "owner", NOW, CAL, {
          ...SETTINGS,
          podborCreditDays: days,
        }),
      ).toThrow(RangeError);
    },
  );
});

describe("effects of cancellation", () => {
  const cancel = (status: "accepted" | "purchasing", settlement = SETTLEMENT): OrderEvent => ({
    ...EVENTS.CANCEL,
    point: POINT_OF[status] ?? "before_accept",
    settlement,
  });

  it("expects every refund, sets the due date, tells the customer and the accountant", () => {
    expect(effectsOf({ status: "accepted" }, cancel("accepted"), "owner")).toEqual([
      { kind: "expect_payment", paymentKind: "fee_refund", amount: 300_000 },
      { kind: "expect_payment", paymentKind: "funds_refund", amount: 10_300_000 },
      { kind: "schedule", job: "refund_due", at: SETTLEMENT.dueBy },
      { kind: "set", field: "refundDueAt", at: SETTLEMENT.dueBy },
      { kind: "notify", to: "customer", templateKey: "order.cancelling" },
      { kind: "notify", to: "owner_topic", templateKey: "accountant.income_adjustment" },
    ]);
  });

  it("an extra fee is a separate expected payment, never offset against purchase funds", () => {
    const settlement = {
      ...SETTLEMENT,
      feeToRefund: sum(0),
      feeToInvoice: sum(500_000),
      fundsToRefund: sum(8_000_000),
    };
    const effects = effectsOf({ status: "purchasing" }, cancel("purchasing", settlement), "owner");
    expect(effects.filter((e) => e.kind === "expect_payment")).toEqual([
      { kind: "expect_payment", paymentKind: "fee_extra", amount: 500_000 },
      { kind: "expect_payment", paymentKind: "funds_refund", amount: 8_000_000 },
    ]);
  });

  it("nothing to pay either way creates no expectations", () => {
    const settlement = { ...SETTLEMENT, feeToRefund: sum(0), feeToInvoice: sum(0), fundsToRefund: sum(0) };
    const effects = effectsOf({ status: "accepted" }, cancel("accepted", settlement), "owner");
    expect(effects.some((e) => e.kind === "expect_payment")).toBe(false);
    expect(effects).toContainEqual({ kind: "schedule", job: "refund_due", at: SETTLEMENT.dueBy });
  });

  it("CANCEL_SETTLED tells the customer", () => {
    const money = { ...FUNDS, documentedLosses: sum(100_000), refunded: sum(1_200_000) };
    expect(effectsOf({ status: "cancelling", money }, EVENTS.CANCEL_SETTLED, "owner")).toEqual([
      { kind: "notify", to: "customer", templateKey: "order.cancelled" },
    ]);
  });
});

describe("effects in general", () => {
  it("every Sum in an effect is a safe integer and every date is valid", () => {
    const cases: [OrderPatch, OrderEvent, Actor][] = [
      [{ status: "estimate_sent" }, EVENTS.ACCEPT, "customer"],
      [{ status: "report_due", purchasesComplete: true, money: FUNDS }, EVENTS.SEND_REPORT, "owner"],
      [{ status: "delivering", money: FUNDS }, EVENTS.HANDOVER, "owner"],
      [{ status: "accepted" }, { ...EVENTS.CANCEL, point: "after_accept_before_purchase" }, "owner"],
    ];
    for (const [patch, event, actor] of cases) {
      for (const e of effectsOf(patch, event, actor)) {
        if ("amount" in e) expect(Number.isSafeInteger(e.amount)).toBe(true);
        if ("at" in e) expect(Number.isNaN(e.at.getTime())).toBe(false);
      }
    }
  });

  it("transition is deterministic: same input, same output", () => {
    const run = () => effectsOf({ status: "delivering", money: FUNDS }, EVENTS.HANDOVER, "owner");
    expect(run()).toEqual(run());
  });

  it("a failed transition returns no effects", () => {
    const r = transition(order({ status: "estimate_draft" }), EVENTS.ACCEPT, "customer", NOW, CAL, SETTINGS);
    expect(r).toEqual({ ok: false, error: "invalid_transition" });
  });
});
