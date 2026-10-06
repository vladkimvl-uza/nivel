import { describe, expect, it } from "vitest";
import { orderTransitionTable, transition } from "./index.ts";
import {
  ALL_ACTORS,
  ALL_EVENT_TYPES,
  ALL_STATUSES,
  CAL,
  DAY,
  DEFAULT_QUOTE,
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
import type { Actor, GuardError, OrderEvent, OrderStatus } from "./types.ts";

type EventType = OrderEvent["type"];

const CANCELLABLE: OrderStatus[] = [
  "estimate_draft",
  "estimate_sent",
  "estimate_expired",
  "accepted",
  "purchasing",
  "report_due",
  "report_sent",
  "settled",
  "assembling",
  "testing",
  "ready",
  "delivering",
];

// ARCHITECTURE 4.9, table of transitions, written down independently of the implementation.
interface Spec {
  from: OrderStatus[];
  event: EventType;
  to: OrderStatus;
  actors: Actor[];
  /** Patch that makes every guard pass. */
  ok: OrderPatch;
}
const FUNDS_OK = { fundsReceived: sum(10_300_000), receiptsTotal: sum(9_000_000) };
const SPEC: Spec[] = [
  { from: ["estimate_draft"], event: "SEND_ESTIMATE", to: "estimate_sent", actors: ["owner"], ok: {} },
  {
    from: ["estimate_sent"],
    event: "EXPIRE",
    to: "estimate_expired",
    actors: ["system"],
    ok: { quote: { validUntil: new Date(NOW.getTime() - 1) } },
  },
  { from: ["estimate_sent", "estimate_expired"], event: "REVISE", to: "estimate_draft", actors: ["owner"], ok: {} },
  { from: ["estimate_sent"], event: "ACCEPT", to: "accepted", actors: ["customer"], ok: {} },
  { from: ["accepted"], event: "FEE_PREPAID", to: "accepted", actors: ["owner"], ok: {} },
  {
    from: ["accepted"],
    event: "FUNDS_RECEIVED",
    to: "accepted",
    actors: ["owner"],
    ok: { money: { fundsReceived: sum(10_300_000) } },
  },
  { from: ["accepted"], event: "MEETING_DONE", to: "accepted", actors: ["owner"], ok: {} },
  {
    from: ["accepted"],
    event: "START_PURCHASE",
    to: "purchasing",
    actors: ["owner"],
    ok: { flags: { feePrepaid: true, fundsReceived: true }, purchaseNotBefore: NOW },
  },
  {
    from: ["purchasing"],
    event: "PURCHASE_RECORDED",
    to: "purchasing",
    actors: ["owner", "assistant"],
    ok: { money: FUNDS_OK },
  },
  {
    from: ["purchasing"],
    event: "PURCHASE_DONE",
    to: "report_due",
    actors: ["owner"],
    ok: { purchasesComplete: true },
  },
  { from: ["report_due"], event: "SEND_REPORT", to: "report_sent", actors: ["owner"], ok: { purchasesComplete: true } },
  { from: ["report_sent"], event: "OBJECTION", to: "report_sent", actors: ["customer"], ok: { report: {} } },
  { from: ["report_sent"], event: "REPORT_ACCEPTED", to: "report_sent", actors: ["customer"], ok: { report: {} } },
  {
    from: ["report_sent"],
    event: "REPORT_DEEMED_ACCEPTED",
    to: "report_sent",
    actors: ["system"],
    ok: { report: {} },
  },
  {
    from: ["report_sent"],
    event: "REMAINDER_SETTLED",
    to: "settled",
    actors: ["owner"],
    ok: { report: { accepted: true }, money: { ...FUNDS_OK, refunded: sum(1_300_000) } },
  },
  { from: ["settled"], event: "MATERIALS_ACCEPTED", to: "assembling", actors: ["owner"], ok: {} },
  { from: ["assembling"], event: "ASSEMBLED", to: "testing", actors: ["owner", "assistant"], ok: {} },
  { from: ["testing"], event: "TESTS_PASSED", to: "ready", actors: ["owner", "assistant"], ok: {} },
  { from: ["ready"], event: "DISPATCH", to: "delivering", actors: ["owner"], ok: {} },
  { from: ["delivering"], event: "HANDOVER", to: "handed_over", actors: ["owner", "customer"], ok: {} },
  { from: ["handed_over"], event: "CLOSE", to: "closed", actors: ["system"], ok: {} },
  {
    from: ["estimate_sent"],
    event: "PODBOR_DELIVERED",
    to: "podbor_delivered",
    actors: ["owner"],
    ok: { kind: "podbor" },
  },
  { from: CANCELLABLE, event: "CANCEL", to: "cancelling", actors: ["owner"], ok: {} },
  {
    from: ["cancelling"],
    event: "CANCEL_SETTLED",
    to: "cancelled",
    actors: ["owner"],
    ok: {
      money: { ...FUNDS_OK, documentedLosses: sum(100_000), refunded: sum(1_200_000) },
    },
  },
];

/** The event to send in `from`; CANCEL carries the point that matches the status. */
function eventFor(type: EventType, from: OrderStatus): OrderEvent {
  if (type === "CANCEL") return { ...EVENTS.CANCEL, point: POINT_OF[from] ?? "before_accept" };
  return EVENTS[type];
}

const run = (patch: OrderPatch, event: OrderEvent, actor: Actor, now: Date = NOW): ReturnType<typeof transition> =>
  transition(order(patch), event, actor, now, CAL, SETTINGS);

describe("the transition table as data", () => {
  it("lists exactly the rows of ARCHITECTURE 4.9", () => {
    const expected = SPEC.flatMap((s) =>
      s.from.map((from) => ({ from, event: s.event, to: s.to, actors: [...s.actors].sort() })),
    );
    const actual = orderTransitionTable().map((r) => ({ ...r, actors: [...r.actors].sort() }));
    const key = (r: { from: string; event: string }) => `${r.from}|${r.event}`;
    expect(actual.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expected.sort((a, b) => key(a).localeCompare(key(b))),
    );
  });

  it("every event type of the contract appears in the table", () => {
    const inTable = new Set(orderTransitionTable().map((r) => r.event));
    expect([...inTable].sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it("the assistant is absent from every money event (ARCHITECTURE 4.9)", () => {
    const money: EventType[] = [
      "FEE_PREPAID",
      "FUNDS_RECEIVED",
      "START_PURCHASE",
      "REMAINDER_SETTLED",
      "HANDOVER",
      "CANCEL",
      "CANCEL_SETTLED",
      "SEND_ESTIMATE",
    ];
    for (const row of orderTransitionTable()) {
      if (money.includes(row.event)) expect(row.actors).not.toContain("assistant");
    }
  });
});

describe("every allowed transition", () => {
  const rows = SPEC.flatMap((s) => s.from.map((from) => [from, s.event, s.to, s] as const));
  it.each(rows)("%s + %s -> %s", (from, event, to, spec) => {
    for (const actor of spec.actors) {
      const r = run({ ...spec.ok, status: from }, eventFor(event, from), actor);
      expect(r, `${actor}`).toMatchObject({ ok: true, next: to });
    }
  });
});

describe("every actor outside the table gets actor_not_allowed", () => {
  const rows = SPEC.flatMap((s) => s.from.map((from) => [from, s.event, s] as const));
  it.each(rows)("%s + %s", (from, event, spec) => {
    for (const actor of ALL_ACTORS.filter((a) => !spec.actors.includes(a))) {
      expect(run({ ...spec.ok, status: from }, eventFor(event, from), actor), `${actor}`).toEqual({
        ok: false,
        error: "actor_not_allowed",
      });
    }
  });

  it("an unknown actor is not allowed", () => {
    expect(run({ status: "estimate_draft" }, EVENTS.SEND_ESTIMATE, "hacker" as Actor)).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
  });
});

describe("every pair that is not in the table is invalid_transition for every actor", () => {
  const allowed = new Set(SPEC.flatMap((s) => s.from.map((from) => `${from}|${s.event}`)));
  it.each(ALL_STATUSES)("from %s", (status) => {
    let checked = 0;
    for (const type of ALL_EVENT_TYPES) {
      if (allowed.has(`${status}|${type}`)) continue;
      for (const actor of ALL_ACTORS) {
        const r = run({ status }, eventFor(type, status), actor);
        expect(r, `${status} + ${type} by ${actor}`).toEqual({ ok: false, error: "invalid_transition" });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("terminal statuses accept nothing", () => {
    for (const status of ["closed", "cancelled", "podbor_delivered"] as const) {
      for (const type of ALL_EVENT_TYPES) {
        expect(run({ status }, eventFor(type, status), "owner").ok).toBe(false);
      }
    }
  });

  it("unknown event types, missing events and unknown statuses are invalid_transition", () => {
    const bad = { type: "TELEPORT" } as unknown as OrderEvent;
    expect(run({ status: "accepted" }, bad, "owner")).toEqual({ ok: false, error: "invalid_transition" });
    expect(run({ status: "accepted" }, undefined as unknown as OrderEvent, "owner")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(run({ status: "accepted" }, null as unknown as OrderEvent, "owner")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(run({ status: "nope" as OrderStatus }, EVENTS.REVISE, "owner")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    // Object.prototype keys must not be mistaken for statuses or events.
    expect(run({ status: "constructor" as OrderStatus }, EVENTS.REVISE, "owner")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(run({ status: "accepted" }, { type: "toString" } as unknown as OrderEvent, "owner")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("an invalid clock is a programming error, not a guard error", () => {
    expect(() => run({ status: "estimate_draft" }, EVENTS.SEND_ESTIMATE, "owner", new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

interface GuardCase {
  name: string;
  status: OrderStatus;
  event: OrderEvent;
  actor: Actor;
  patch: OrderPatch;
  error: GuardError;
}
const past = new Date(NOW.getTime() - 1);
const GUARDS: GuardCase[] = [
  // SEND_ESTIMATE
  {
    name: "SEND_ESTIMATE: quote not checked by hand",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { manuallyChecked: false } },
    error: "manual_check_missing",
  },
  {
    name: "SEND_ESTIMATE: event without manuallyChecked",
    status: "estimate_draft",
    event: { ...EVENTS.SEND_ESTIMATE, manuallyChecked: false } as unknown as OrderEvent,
    actor: "owner",
    patch: {},
    error: "manual_check_missing",
  },
  {
    name: "SEND_ESTIMATE: compatibility verdict block",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { compatVerdict: "block" } },
    error: "compat_block",
  },
  {
    name: "SEND_ESTIMATE: below the minimum estimate (podbor only) for a PC",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { eligibility: { mode: "podbor_only", reason: "below_min" } } },
    error: "not_eligible",
  },
  {
    name: "SEND_ESTIMATE: setup below the minimum",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { kind: "setup", quote: { eligibility: { mode: "setup_below_min" } } },
    error: "not_eligible",
  },
  {
    name: "SEND_ESTIMATE: region podbor for an upgrade",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { kind: "upgrade", quote: { eligibility: { mode: "podbor_only", reason: "region" } } },
    error: "not_eligible",
  },
  {
    name: "SEND_ESTIMATE: no quote",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: null },
    error: "invalid_transition",
  },
  {
    name: "SEND_ESTIMATE: another quote id",
    status: "estimate_draft",
    event: { ...EVENTS.SEND_ESTIMATE, quoteId: "Q-OLD" },
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "SEND_ESTIMATE: validity already over",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { validUntil: past } },
    error: "estimate_expired",
  },
  {
    name: "SEND_ESTIMATE: no validUntil (the expiry job would have no term)",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { validUntil: undefined } },
    error: "invalid_transition",
  },
  {
    name: "SEND_ESTIMATE: validUntil is an Invalid Date",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { validUntil: new Date(Number.NaN) } },
    error: "invalid_transition",
  },
  {
    name: "ACCEPT: no validUntil counts as expired (fail closed)",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { quote: { validUntil: undefined } },
    error: "estimate_expired",
  },
  {
    name: "ACCEPT: validUntil is an Invalid Date counts as expired (fail closed)",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { quote: { validUntil: new Date(Number.NaN) } },
    error: "estimate_expired",
  },
  {
    name: "START_PURCHASE: purchaseNotBefore is an Invalid Date",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: { flags: { feePrepaid: true, fundsReceived: true }, purchaseNotBefore: new Date(Number.NaN) },
    error: "purchase_too_early",
  },
  {
    name: "FUNDS_RECEIVED: receivedAt is an Invalid Date",
    status: "accepted",
    event: { type: "FUNDS_RECEIVED", paymentIds: ["p2"], receivedAt: new Date(Number.NaN) },
    actor: "owner",
    patch: { money: { fundsReceived: sum(10_300_000) } },
    error: "payments_incomplete",
  },
  {
    name: "FUNDS_RECEIVED: receivedAt is not a Date (an ISO string after a JSON round trip)",
    status: "accepted",
    event: { type: "FUNDS_RECEIVED", paymentIds: ["p2"], receivedAt: "2026-10-06T11:00:00+05:00" as unknown as Date },
    actor: "owner",
    patch: { money: { fundsReceived: sum(10_300_000) } },
    error: "payments_incomplete",
  },
  {
    name: "SEND_ESTIMATE: manual check is reported before compatibility and eligibility",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: {
      quote: {
        manuallyChecked: false,
        compatVerdict: "block",
        eligibility: { mode: "podbor_only", reason: "manual" },
      },
    },
    error: "manual_check_missing",
  },
  {
    name: "SEND_ESTIMATE: compatibility is reported before eligibility",
    status: "estimate_draft",
    event: EVENTS.SEND_ESTIMATE,
    actor: "owner",
    patch: { quote: { compatVerdict: "block", eligibility: { mode: "setup_below_min" } } },
    error: "compat_block",
  },
  // EXPIRE
  {
    name: "EXPIRE: exactly at validUntil is not expired yet",
    status: "estimate_sent",
    event: EVENTS.EXPIRE,
    actor: "system",
    patch: { quote: { validUntil: NOW } },
    error: "invalid_transition",
  },
  {
    name: "EXPIRE: still valid",
    status: "estimate_sent",
    event: EVENTS.EXPIRE,
    actor: "system",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "EXPIRE: no quote",
    status: "estimate_sent",
    event: EVENTS.EXPIRE,
    actor: "system",
    patch: { quote: null },
    error: "invalid_transition",
  },
  // ACCEPT
  {
    name: "ACCEPT: estimate expired by the clock",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { quote: { validUntil: past } },
    error: "estimate_expired",
  },
  {
    name: "ACCEPT: Uzbek offer is only a stub",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { offer: { uz: "stub" } },
    error: "offer_not_published",
  },
  {
    name: "ACCEPT: Russian offer approved but not published",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { offer: { ru: "lawyer_approved" } },
    error: "offer_not_published",
  },
  {
    name: "ACCEPT: stub offers in staging",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { appMode: "staging", offer: { uz: "stub", ru: "stub" } },
    error: "offer_not_published",
  },
  {
    name: "ACCEPT: no consents",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: [] },
    actor: "customer",
    patch: {},
    error: "consent_missing",
  },
  {
    name: "ACCEPT: one consent instead of two",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: ["c1"] },
    actor: "customer",
    patch: {},
    error: "consent_missing",
  },
  {
    name: "ACCEPT: the same consent twice",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: ["c1", "c1"] },
    actor: "customer",
    patch: {},
    error: "consent_missing",
  },
  {
    name: "ACCEPT: blank consent id",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: ["c1", "  "] },
    actor: "customer",
    patch: {},
    error: "consent_missing",
  },
  {
    name: "ACCEPT: non-returnable lines need a third consent",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { quote: { hasNonReturnable: true } },
    error: "consent_missing",
  },
  {
    name: "ACCEPT: consentIds is not an array",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: undefined } as unknown as OrderEvent,
    actor: "customer",
    patch: {},
    error: "consent_missing",
  },
  {
    name: "ACCEPT: another quote id",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, quoteId: "Q-OLD" },
    actor: "customer",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "ACCEPT: no quote",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { quote: null },
    error: "invalid_transition",
  },
  {
    name: "ACCEPT: a podbor order goes to PODBOR_DELIVERED, not to the purchase flow",
    status: "estimate_sent",
    event: EVENTS.ACCEPT,
    actor: "customer",
    patch: { kind: "podbor" },
    error: "invalid_transition",
  },
  {
    name: "ACCEPT: expiry is reported before offers, offers before consents",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: [] },
    actor: "customer",
    patch: { quote: { validUntil: past }, offer: { uz: "stub" } },
    error: "estimate_expired",
  },
  {
    name: "ACCEPT: offers are reported before consents",
    status: "estimate_sent",
    event: { ...EVENTS.ACCEPT, consentIds: [] },
    actor: "customer",
    patch: { offer: { uz: "stub" } },
    error: "offer_not_published",
  },
  // FEE_PREPAID
  {
    name: "FEE_PREPAID: no payment id",
    status: "accepted",
    event: { ...EVENTS.FEE_PREPAID, paymentId: "" },
    actor: "owner",
    patch: {},
    error: "payments_incomplete",
  },
  {
    name: "FEE_PREPAID: already registered",
    status: "accepted",
    event: EVENTS.FEE_PREPAID,
    actor: "owner",
    patch: { flags: { feePrepaid: true } },
    error: "invalid_transition",
  },
  // FUNDS_RECEIVED
  {
    name: "FUNDS_RECEIVED: no payments",
    status: "accepted",
    event: { ...EVENTS.FUNDS_RECEIVED, paymentIds: [] },
    actor: "owner",
    patch: { money: { fundsReceived: sum(10_300_000) } },
    error: "payments_incomplete",
  },
  {
    name: "FUNDS_RECEIVED: one sum short of the purchase limit",
    status: "accepted",
    event: EVENTS.FUNDS_RECEIVED,
    actor: "owner",
    patch: { money: { fundsReceived: sum(10_299_999) } },
    error: "payments_incomplete",
  },
  {
    name: "FUNDS_RECEIVED: nothing confirmed",
    status: "accepted",
    event: EVENTS.FUNDS_RECEIVED,
    actor: "owner",
    patch: {},
    error: "payments_incomplete",
  },
  {
    name: "FUNDS_RECEIVED: no quote",
    status: "accepted",
    event: EVENTS.FUNDS_RECEIVED,
    actor: "owner",
    patch: { quote: null, money: { fundsReceived: sum(10_300_000) } },
    error: "invalid_transition",
  },
  {
    name: "FUNDS_RECEIVED: already registered",
    status: "accepted",
    event: EVENTS.FUNDS_RECEIVED,
    actor: "owner",
    patch: { flags: { fundsReceived: true }, money: { fundsReceived: sum(10_300_000) } },
    error: "invalid_transition",
  },
  // MEETING_DONE
  {
    name: "MEETING_DONE: already registered",
    status: "accepted",
    event: EVENTS.MEETING_DONE,
    actor: "owner",
    patch: { flags: { firstOrderMeetingDone: true } },
    error: "invalid_transition",
  },
  // START_PURCHASE
  {
    name: "START_PURCHASE: fee advance not received",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: { flags: { feePrepaid: false, fundsReceived: true }, purchaseNotBefore: NOW },
    error: "payments_incomplete",
  },
  {
    name: "START_PURCHASE: purchase funds not received",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: { flags: { feePrepaid: true, fundsReceived: false }, purchaseNotBefore: NOW },
    error: "payments_incomplete",
  },
  {
    name: "START_PURCHASE: one millisecond before purchaseNotBefore",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: {
      flags: { feePrepaid: true, fundsReceived: true },
      purchaseNotBefore: new Date(NOW.getTime() + 1),
    },
    error: "purchase_too_early",
  },
  {
    name: "START_PURCHASE: funds the day before, purchase the same day (next working day not reached)",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: { flags: { feePrepaid: true, fundsReceived: true }, purchaseNotBefore: tk("2026-10-07T10:00:00") },
    error: "purchase_too_early",
  },
  {
    name: "START_PURCHASE: flag set but purchaseNotBefore is missing",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: { flags: { feePrepaid: true, fundsReceived: true } },
    error: "purchase_too_early",
  },
  {
    name: "START_PURCHASE: first order from 15 million without a meeting",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: {
      flags: { feePrepaid: true, fundsReceived: true },
      purchaseNotBefore: NOW,
      firstOrderOfCustomer: true,
      grandTotal: sum(15_000_000),
    },
    error: "meeting_required",
  },
  {
    name: "START_PURCHASE: payments are reported before the date and the meeting",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: {
      flags: { feePrepaid: false, fundsReceived: false },
      firstOrderOfCustomer: true,
      grandTotal: sum(50_000_000),
    },
    error: "payments_incomplete",
  },
  {
    name: "START_PURCHASE: the date is reported before the meeting",
    status: "accepted",
    event: EVENTS.START_PURCHASE,
    actor: "owner",
    patch: {
      flags: { feePrepaid: true, fundsReceived: true },
      purchaseNotBefore: new Date(NOW.getTime() + HOUR),
      firstOrderOfCustomer: true,
      grandTotal: sum(50_000_000),
    },
    error: "purchase_too_early",
  },
  // PURCHASE_RECORDED
  {
    name: "PURCHASE_RECORDED: receipts above the limit without consent",
    status: "purchasing",
    event: EVENTS.PURCHASE_RECORDED,
    actor: "owner",
    patch: { money: { fundsReceived: sum(11_000_000), receiptsTotal: sum(10_300_001) } },
    error: "limit_exceeded",
  },
  {
    name: "PURCHASE_RECORDED: assistant also gets limit_exceeded",
    status: "purchasing",
    event: EVENTS.PURCHASE_RECORDED,
    actor: "assistant",
    patch: { money: { fundsReceived: sum(11_000_000), receiptsTotal: sum(10_300_001) } },
    error: "limit_exceeded",
  },
  {
    name: "PURCHASE_RECORDED: overrun consent but not enough money received",
    status: "purchasing",
    event: EVENTS.PURCHASE_RECORDED,
    actor: "owner",
    patch: {
      money: { fundsReceived: sum(10_300_000), receiptsTotal: sum(10_500_000), hasLimitOverrunConsent: true },
    },
    error: "funds_exceeded",
  },
  {
    name: "PURCHASE_RECORDED: receipts above the money received while under the limit",
    status: "purchasing",
    event: EVENTS.PURCHASE_RECORDED,
    actor: "owner",
    patch: { money: { fundsReceived: sum(8_000_000), receiptsTotal: sum(9_000_000) } },
    error: "funds_exceeded",
  },
  {
    name: "PURCHASE_RECORDED: the limit is reported first when both are exceeded",
    status: "purchasing",
    event: EVENTS.PURCHASE_RECORDED,
    actor: "owner",
    patch: { money: { fundsReceived: sum(8_000_000), receiptsTotal: sum(11_000_000) } },
    error: "limit_exceeded",
  },
  {
    name: "PURCHASE_RECORDED: no quote",
    status: "purchasing",
    event: EVENTS.PURCHASE_RECORDED,
    actor: "owner",
    patch: { quote: null, money: FUNDS_OK },
    error: "invalid_transition",
  },
  // PURCHASE_DONE and SEND_REPORT
  {
    name: "PURCHASE_DONE: some lines are not bought or removed with consent",
    status: "purchasing",
    event: EVENTS.PURCHASE_DONE,
    actor: "owner",
    patch: { purchasesComplete: false },
    error: "purchases_incomplete",
  },
  {
    name: "SEND_REPORT: report is not built from complete purchases",
    status: "report_due",
    event: EVENTS.SEND_REPORT,
    actor: "owner",
    patch: { purchasesComplete: false },
    error: "purchases_incomplete",
  },
  // OBJECTION, REPORT_ACCEPTED, REPORT_DEEMED_ACCEPTED
  {
    name: "OBJECTION: report already accepted",
    status: "report_sent",
    event: EVENTS.OBJECTION,
    actor: "customer",
    patch: { report: { accepted: true } },
    error: "invalid_transition",
  },
  {
    name: "OBJECTION: no report",
    status: "report_sent",
    event: EVENTS.OBJECTION,
    actor: "customer",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "OBJECTION: blank text",
    status: "report_sent",
    event: { ...EVENTS.OBJECTION, text: "   " },
    actor: "customer",
    patch: { report: {} },
    error: "invalid_transition",
  },
  {
    name: "REPORT_ACCEPTED: objection still open",
    status: "report_sent",
    event: EVENTS.REPORT_ACCEPTED,
    actor: "customer",
    patch: { report: { objectionOpen: true } },
    error: "report_objection_open",
  },
  {
    name: "REPORT_ACCEPTED: already accepted",
    status: "report_sent",
    event: EVENTS.REPORT_ACCEPTED,
    actor: "customer",
    patch: { report: { accepted: true } },
    error: "invalid_transition",
  },
  {
    name: "REPORT_ACCEPTED: no report",
    status: "report_sent",
    event: EVENTS.REPORT_ACCEPTED,
    actor: "customer",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "REPORT_DEEMED_ACCEPTED: objection still open",
    status: "report_sent",
    event: EVENTS.REPORT_DEEMED_ACCEPTED,
    actor: "system",
    patch: { report: { objectionOpen: true } },
    error: "report_objection_open",
  },
  {
    name: "REPORT_DEEMED_ACCEPTED: already accepted",
    status: "report_sent",
    event: EVENTS.REPORT_DEEMED_ACCEPTED,
    actor: "system",
    patch: { report: { accepted: true } },
    error: "invalid_transition",
  },
  {
    name: "REPORT_DEEMED_ACCEPTED: no report",
    status: "report_sent",
    event: EVENTS.REPORT_DEEMED_ACCEPTED,
    actor: "system",
    patch: {},
    error: "invalid_transition",
  },
  // REMAINDER_SETTLED
  {
    name: "REMAINDER_SETTLED: report not accepted yet",
    status: "report_sent",
    event: EVENTS.REMAINDER_SETTLED,
    actor: "owner",
    patch: { report: { accepted: false }, money: { ...FUNDS_OK, refunded: sum(1_300_000) } },
    error: "report_objection_open",
  },
  {
    name: "REMAINDER_SETTLED: objection open",
    status: "report_sent",
    event: EVENTS.REMAINDER_SETTLED,
    actor: "owner",
    patch: { report: { accepted: true, objectionOpen: true }, money: { ...FUNDS_OK, refunded: sum(1_300_000) } },
    error: "report_objection_open",
  },
  {
    name: "REMAINDER_SETTLED: no report object",
    status: "report_sent",
    event: EVENTS.REMAINDER_SETTLED,
    actor: "owner",
    patch: { money: { ...FUNDS_OK, refunded: sum(1_300_000) } },
    error: "invalid_transition",
  },
  {
    name: "REMAINDER_SETTLED: remainder not refunded",
    status: "report_sent",
    event: EVENTS.REMAINDER_SETTLED,
    actor: "owner",
    patch: { report: { accepted: true }, money: { ...FUNDS_OK, refunded: sum(0) } },
    error: "not_reconciled",
  },
  {
    name: "REMAINDER_SETTLED: one sum short of the remainder",
    status: "report_sent",
    event: EVENTS.REMAINDER_SETTLED,
    actor: "owner",
    patch: { report: { accepted: true }, money: { ...FUNDS_OK, refunded: sum(1_299_999) } },
    error: "not_reconciled",
  },
  {
    name: "REMAINDER_SETTLED: refunded more than the remainder",
    status: "report_sent",
    event: EVENTS.REMAINDER_SETTLED,
    actor: "owner",
    patch: { report: { accepted: true }, money: { ...FUNDS_OK, refunded: sum(1_300_001) } },
    error: "not_reconciled",
  },
  // MATERIALS_ACCEPTED, TESTS_PASSED, HANDOVER
  {
    name: "MATERIALS_ACCEPTED: no act",
    status: "settled",
    event: { ...EVENTS.MATERIALS_ACCEPTED, actId: "" },
    actor: "owner",
    patch: {},
    error: "act_missing",
  },
  {
    name: "TESTS_PASSED: no passport",
    status: "testing",
    event: { ...EVENTS.TESTS_PASSED, passportId: " " },
    actor: "owner",
    patch: {},
    error: "passport_missing",
  },
  {
    name: "TESTS_PASSED: assistant without passport",
    status: "testing",
    event: { ...EVENTS.TESTS_PASSED, passportId: "" },
    actor: "assistant",
    patch: {},
    error: "passport_missing",
  },
  {
    name: "HANDOVER: no act",
    status: "delivering",
    event: { ...EVENTS.HANDOVER, actId: "" },
    actor: "owner",
    patch: {},
    error: "act_missing",
  },
  {
    name: "HANDOVER: no final payment",
    status: "delivering",
    event: { ...EVENTS.HANDOVER, finalPaymentId: "" },
    actor: "owner",
    patch: {},
    error: "final_payment_missing",
  },
  {
    name: "HANDOVER: customer button without the final payment",
    status: "delivering",
    event: { ...EVENTS.HANDOVER, finalPaymentId: " " },
    actor: "customer",
    patch: {},
    error: "final_payment_missing",
  },
  {
    name: "HANDOVER: the act is reported before the payment",
    status: "delivering",
    event: { ...EVENTS.HANDOVER, actId: "", finalPaymentId: "" },
    actor: "owner",
    patch: {},
    error: "act_missing",
  },
  // CLOSE
  {
    name: "CLOSE: objection still open",
    status: "handed_over",
    event: EVENTS.CLOSE,
    actor: "system",
    patch: { report: { accepted: true, objectionOpen: true } },
    error: "report_objection_open",
  },
  {
    name: "CLOSE: money not reconciled",
    status: "handed_over",
    event: EVENTS.CLOSE,
    actor: "system",
    patch: { money: { ...FUNDS_OK, refunded: sum(0) } },
    error: "not_reconciled",
  },
  // PODBOR_DELIVERED
  {
    name: "PODBOR_DELIVERED: only for the podbor kind",
    status: "estimate_sent",
    event: EVENTS.PODBOR_DELIVERED,
    actor: "owner",
    patch: { kind: "pc" },
    error: "invalid_transition",
  },
  {
    name: "PODBOR_DELIVERED: Uzbek offer is a stub",
    status: "estimate_sent",
    event: EVENTS.PODBOR_DELIVERED,
    actor: "owner",
    patch: { kind: "podbor", offer: { uz: "stub" } },
    error: "offer_not_published",
  },
  {
    name: "PODBOR_DELIVERED: Russian offer is not published in production",
    status: "estimate_sent",
    event: EVENTS.PODBOR_DELIVERED,
    actor: "owner",
    patch: { kind: "podbor", offer: { ru: "lawyer_approved" } },
    error: "offer_not_published",
  },
  {
    name: "PODBOR_DELIVERED: no payment",
    status: "estimate_sent",
    event: { ...EVENTS.PODBOR_DELIVERED, paymentId: "" },
    actor: "owner",
    patch: { kind: "podbor" },
    error: "payments_incomplete",
  },
  // CANCEL
  {
    name: "CANCEL: the point does not match the status (before_accept in purchasing)",
    status: "purchasing",
    event: { ...EVENTS.CANCEL, point: "before_accept" },
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "CANCEL: the point does not match the status (after tests while accepted)",
    status: "accepted",
    event: { ...EVENTS.CANCEL, point: "after_tests_before_handover" },
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "CANCEL: unknown point",
    status: "accepted",
    event: { ...EVENTS.CANCEL, point: "whenever" } as unknown as OrderEvent,
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "CANCEL: a point named like an Object.prototype key",
    status: "accepted",
    event: { ...EVENTS.CANCEL, point: "constructor" } as unknown as OrderEvent,
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "CANCEL: no settlement",
    status: "accepted",
    event: { ...EVENTS.CANCEL, point: "after_accept_before_purchase", settlement: undefined } as unknown as OrderEvent,
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  {
    name: "CANCEL: blank reason",
    status: "accepted",
    event: { ...EVENTS.CANCEL, point: "after_accept_before_purchase", reason: "  " },
    actor: "owner",
    patch: {},
    error: "invalid_transition",
  },
  // CANCEL_SETTLED
  {
    name: "CANCEL_SETTLED: the client has been refunded less than owed",
    status: "cancelling",
    event: EVENTS.CANCEL_SETTLED,
    actor: "owner",
    patch: { money: { ...FUNDS_OK, documentedLosses: sum(100_000), refunded: sum(1_199_999) } },
    error: "not_reconciled",
  },
  {
    name: "CANCEL_SETTLED: nothing refunded although funds are unspent",
    status: "cancelling",
    event: EVENTS.CANCEL_SETTLED,
    actor: "owner",
    patch: { money: { fundsReceived: sum(10_300_000) } },
    error: "not_reconciled",
  },
];

describe("every guard", () => {
  it.each(GUARDS.map((g) => [g.name, g] as const))("%s", (_name, g) => {
    expect(run({ ...g.patch, status: g.status }, g.event, g.actor)).toEqual({ ok: false, error: g.error });
  });

  it("covers every GuardError of the contract", () => {
    const seen = new Set<GuardError>(GUARDS.map((g) => g.error));
    seen.add("actor_not_allowed");
    const all: GuardError[] = [
      "actor_not_allowed",
      "invalid_transition",
      "estimate_expired",
      "manual_check_missing",
      "compat_block",
      "not_eligible",
      "offer_not_published",
      "consent_missing",
      "payments_incomplete",
      "purchase_too_early",
      "meeting_required",
      "limit_exceeded",
      "funds_exceeded",
      "purchases_incomplete",
      "not_reconciled",
      "report_objection_open",
      "final_payment_missing",
      "act_missing",
      "passport_missing",
    ];
    expect([...seen].sort()).toEqual([...all].sort());
  });
});

describe("boundaries that must pass", () => {
  it.each([
    ["warn verdict", { quote: { compatVerdict: "warn" as const } }],
    ["incomplete verdict (owner checked it by hand)", { quote: { compatVerdict: "incomplete" as const } }],
    [
      "free window estimate",
      { quote: { eligibility: { mode: "free_window_only" as const, minEstimate: sum(4_500_000) } } },
    ],
    ["validUntil in one millisecond", { quote: { validUntil: new Date(NOW.getTime() + 1) } }],
    ["stub offers (Р-25: the stub is allowed in an estimate)", { offer: { uz: "stub" as const, ru: "stub" as const } }],
  ])("SEND_ESTIMATE with %s", (_name, patch) => {
    expect(run({ ...patch, status: "estimate_draft" }, EVENTS.SEND_ESTIMATE, "owner").ok).toBe(true);
  });

  it("SEND_ESTIMATE for a podbor order accepts a podbor_only estimate", () => {
    const r = run(
      {
        status: "estimate_draft",
        kind: "podbor",
        quote: { eligibility: { mode: "podbor_only", reason: "below_min" } },
      },
      EVENTS.SEND_ESTIMATE,
      "owner",
    );
    expect(r.ok).toBe(true);
  });

  it("EXPIRE one millisecond after validUntil", () => {
    const r = run(
      { status: "estimate_sent", quote: { validUntil: new Date(NOW.getTime() - 1) } },
      EVENTS.EXPIRE,
      "system",
    );
    expect(r).toMatchObject({ ok: true, next: "estimate_expired" });
  });

  it("ACCEPT exactly at validUntil is still valid", () => {
    expect(run({ status: "estimate_sent", quote: { validUntil: NOW } }, EVENTS.ACCEPT, "customer").ok).toBe(true);
  });

  it("EXPIRE without validUntil lets the stuck estimate expire", () => {
    const r = run({ status: "estimate_sent", quote: { validUntil: undefined } }, EVENTS.EXPIRE, "system");
    expect(r).toMatchObject({ ok: true, next: "estimate_expired" });
  });

  it("EXPIRE with an Invalid Date validUntil lets the stuck estimate expire", () => {
    const r = run({ status: "estimate_sent", quote: { validUntil: new Date(Number.NaN) } }, EVENTS.EXPIRE, "system");
    expect(r).toMatchObject({ ok: true, next: "estimate_expired" });
  });

  it("ACCEPT in development mode works with stub offers", () => {
    const patch: OrderPatch = { status: "estimate_sent", appMode: "development", offer: { uz: "stub", ru: "stub" } };
    expect(run(patch, EVENTS.ACCEPT, "customer").ok).toBe(true);
  });

  it("ACCEPT with non-returnable lines needs and accepts three consents", () => {
    const patch: OrderPatch = { status: "estimate_sent", quote: { hasNonReturnable: true } };
    expect(run(patch, { ...EVENTS.ACCEPT, consentIds: ["c1", "c2", "c3"] }, "customer").ok).toBe(true);
  });

  it("ACCEPT on every channel", () => {
    for (const channel of ["bot", "site", "tma"] as const) {
      expect(run({ status: "estimate_sent" }, { ...EVENTS.ACCEPT, channel }, "customer").ok).toBe(true);
    }
  });

  it("FUNDS_RECEIVED with more than the limit is fine", () => {
    expect(
      run({ status: "accepted", money: { fundsReceived: sum(12_000_000) } }, EVENTS.FUNDS_RECEIVED, "owner").ok,
    ).toBe(true);
  });

  it("START_PURCHASE: a first order of 14 999 999 needs no meeting, 15 000 000 with the meeting passes", () => {
    const base: OrderPatch = {
      status: "accepted",
      flags: { feePrepaid: true, fundsReceived: true },
      purchaseNotBefore: NOW,
      firstOrderOfCustomer: true,
    };
    expect(run({ ...base, grandTotal: sum(14_999_999) }, EVENTS.START_PURCHASE, "owner").ok).toBe(true);
    expect(
      run(
        {
          ...base,
          grandTotal: sum(15_000_000),
          flags: { feePrepaid: true, fundsReceived: true, firstOrderMeetingDone: true },
        },
        EVENTS.START_PURCHASE,
        "owner",
      ).ok,
    ).toBe(true);
  });

  it("START_PURCHASE: a repeat customer needs no meeting at any size", () => {
    const patch: OrderPatch = {
      status: "accepted",
      flags: { feePrepaid: true, fundsReceived: true },
      purchaseNotBefore: NOW,
      firstOrderOfCustomer: false,
      grandTotal: sum(80_000_000),
    };
    expect(run(patch, EVENTS.START_PURCHASE, "owner").ok).toBe(true);
  });

  it("PURCHASE_RECORDED: receipts equal to the limit and to the money received pass", () => {
    const patch: OrderPatch = {
      status: "purchasing",
      money: { fundsReceived: sum(10_300_000), receiptsTotal: sum(10_300_000) },
    };
    expect(run(patch, EVENTS.PURCHASE_RECORDED, "assistant").ok).toBe(true);
  });

  it("PURCHASE_RECORDED: with the overrun consent and enough money the limit may be exceeded", () => {
    const patch: OrderPatch = {
      status: "purchasing",
      money: { fundsReceived: sum(10_600_000), receiptsTotal: sum(10_500_000), hasLimitOverrunConsent: true },
    };
    expect(run(patch, EVENTS.PURCHASE_RECORDED, "owner").ok).toBe(true);
  });

  it("REMAINDER_SETTLED with nothing to refund", () => {
    const patch: OrderPatch = {
      status: "report_sent",
      report: { accepted: true },
      money: { fundsReceived: sum(9_000_000), receiptsTotal: sum(9_000_000), refunded: sum(0) },
    };
    expect(run(patch, { type: "REMAINDER_SETTLED" }, "owner").ok).toBe(true);
  });

  it("CLOSE with a closed objection and reconciled money", () => {
    const patch: OrderPatch = {
      status: "handed_over",
      report: { accepted: true, objectionOpen: false },
      money: { ...FUNDS_OK, refunded: sum(1_300_000) },
    };
    expect(run(patch, EVENTS.CLOSE, "system").ok).toBe(true);
  });

  it("CANCEL_SETTLED with the exact refund, with a bigger one (shop refunds) and with nothing owed", () => {
    const exact: OrderPatch = {
      status: "cancelling",
      money: { ...FUNDS_OK, documentedLosses: sum(100_000), refunded: sum(1_200_000) },
    };
    expect(run(exact, EVENTS.CANCEL_SETTLED, "owner").ok).toBe(true);
    expect(
      run({ ...exact, money: { ...exact.money, refunded: sum(1_500_000) } }, EVENTS.CANCEL_SETTLED, "owner").ok,
    ).toBe(true);
    expect(run({ status: "cancelling" }, EVENTS.CANCEL_SETTLED, "owner").ok).toBe(true);
    // Losses and receipts above the money received leave nothing to refund.
    expect(
      run(
        {
          status: "cancelling",
          money: { fundsReceived: sum(1_000_000), receiptsTotal: sum(900_000), documentedLosses: sum(300_000) },
        },
        EVENTS.CANCEL_SETTLED,
        "owner",
      ).ok,
    ).toBe(true);
  });

  it("CANCEL is allowed in each of the twelve statuses before handover and in none after", () => {
    for (const status of ALL_STATUSES) {
      const r = run({ status }, eventFor("CANCEL", status), "owner");
      expect(r.ok, status).toBe(CANCELLABLE.includes(status));
    }
  });

  it("CANCEL after the purchase and during assembly: points are matched per status", () => {
    for (const status of CANCELLABLE) {
      const wrong = Object.values(POINT_OF).find((p) => p !== POINT_OF[status]);
      expect(run({ status }, { ...EVENTS.CANCEL, point: wrong ?? "before_accept" }, "owner"), status).toEqual({
        ok: false,
        error: "invalid_transition",
      });
    }
  });

  it("does not mutate the snapshot or the event", () => {
    const snapshot = order({ status: "estimate_sent" });
    const event = { ...EVENTS.ACCEPT, consentIds: [...EVENTS.ACCEPT.consentIds] };
    const before = JSON.stringify([snapshot, event]);
    transition(snapshot, event, "customer", NOW, CAL, SETTINGS);
    expect(JSON.stringify([snapshot, event])).toBe(before);
  });

  it("uses the default quote fixture as the sanity check of the fixtures", () => {
    expect(DEFAULT_QUOTE.validUntil?.getTime()).toBe(NOW.getTime() + DAY);
    expect(SETTLEMENT.dueBy.getTime()).toBeGreaterThan(NOW.getTime());
  });
});
