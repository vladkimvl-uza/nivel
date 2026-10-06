// The order automaton as data: ARCHITECTURE 4.9, one rule per row of the table of transitions.
// A rule says who may send which event in which status, what must hold (guard) and what follows (effects).
// Flags (feePrepaid, fundsReceived, meeting, report.accepted) are set by the caller from the event type; the
// guards read them from the snapshot, so a repeated event is rejected instead of being applied twice.
import { addMonthsTashkent } from "../calendar/tashkent.ts";
import type { CancelPoint } from "../cancel/types.ts";
import type { FeeSettings } from "../fee/types.ts";
import type { Sum } from "../money/types.ts";
import { receiptsReserve, warrantyReserve } from "./reserves.ts";
import type { Actor, Effect, GuardError, OrderEvent, OrderSnapshot, OrderStatus, WorkCalendar } from "./types.ts";

type EventType = OrderEvent["type"];
type EventOf<T extends EventType> = Extract<OrderEvent, { type: T }>;

export interface RuleContext<E extends OrderEvent> {
  o: OrderSnapshot;
  e: E;
  now: Date;
  cal: WorkCalendar;
  s: FeeSettings;
}
interface RuleDef<T extends EventType> {
  from: readonly OrderStatus[];
  event: T;
  to: OrderStatus;
  actors: readonly Actor[];
  guard?: (c: RuleContext<EventOf<T>>) => GuardError | undefined;
  effects?: (c: RuleContext<EventOf<T>>) => Effect[];
}
/** A rule with the event type erased, as stored in the table. */
export interface Rule {
  from: readonly OrderStatus[];
  event: EventType;
  to: OrderStatus;
  actors: readonly Actor[];
  guard?: (c: RuleContext<OrderEvent>) => GuardError | undefined;
  effects?: (c: RuleContext<OrderEvent>) => Effect[];
}
const rule = <T extends EventType>(def: RuleDef<T>): Rule => def as unknown as Rule;

/** First order of a customer from this grand total needs a meeting or a video call before the purchase (4.9). */
export const FIRST_ORDER_MEETING_FROM = 15_000_000;
/** Consents at ACCEPT: personal data processing and transfer of data to suppliers; plus non-returnable goods. */
const BASE_CONSENTS = 2;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const asSum = (n: number): Sum => n as Sum;
const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
const after = (from: Date, ms: number): Date => new Date(from.getTime() + ms);
const offersPublished = (o: OrderSnapshot): boolean => o.offer.uz === "published" && o.offer.ru === "published";
const expired = (o: OrderSnapshot, now: Date): boolean =>
  o.quote?.validUntil !== undefined && now.getTime() > o.quote.validUntil.getTime();
const notify = (to: "customer" | "owner_topic", templateKey: string): Effect => ({ kind: "notify", to, templateKey });
const expectPayment = (
  paymentKind: Extract<Effect, { kind: "expect_payment" }>["paymentKind"],
  amount: Sum,
): Effect[] => (amount > 0 ? [{ kind: "expect_payment", paymentKind, amount }] : []);
/** Money in must equal receipts plus what went back to the customer (4.9, REMAINDER_SETTLED and CLOSE). */
const reconciled = (o: OrderSnapshot): boolean => o.money.fundsReceived === o.money.receiptsTotal + o.money.refunded;
/** Offers in both languages must be published; development mode is exempt so the flow can be tested (4.9). */
const offersGuard = (o: OrderSnapshot): GuardError | undefined =>
  o.appMode === "development" || offersPublished(o) ? undefined : "offer_not_published";

/** Cancel point that is valid for each status (4.7): the settlement is calculated for exactly this point. */
const CANCEL_POINTS: Readonly<Record<CancelPoint, readonly OrderStatus[]>> = {
  before_accept: ["estimate_draft", "estimate_sent", "estimate_expired"],
  after_accept_before_purchase: ["accepted"],
  after_purchase_before_assembly: ["purchasing", "report_due", "report_sent", "settled"],
  during_assembly: ["assembling", "testing"],
  after_tests_before_handover: ["ready", "delivering"],
};
const CANCELLABLE: readonly OrderStatus[] = Object.values(CANCEL_POINTS).flat();

export const RULES: readonly Rule[] = [
  rule({
    from: ["estimate_draft"],
    event: "SEND_ESTIMATE",
    to: "estimate_sent",
    actors: ["owner"],
    guard: ({ o, e, now }) => {
      const q = o.quote;
      if (q === undefined || q.id !== e.quoteId) return "invalid_transition";
      if (e.manuallyChecked !== true || !q.manuallyChecked) return "manual_check_missing";
      if (q.compatVerdict === "block") return "compat_block";
      const eligible = q.eligibility.mode === "full_cycle" || q.eligibility.mode === "free_window_only";
      if (o.kind !== "podbor" && !eligible) return "not_eligible";
      if (expired(o, now)) return "estimate_expired";
      return undefined;
    },
    effects: ({ o, now, s }) => [
      // A stub offer is allowed in an estimate (R-25) but the PDF then carries the "not an offer" watermark.
      { kind: "render_pdf", doc: "quote", watermarkDraft: !offersPublished(o) },
      notify("customer", "order.estimate_sent"),
      {
        kind: "schedule",
        job: "estimate_expiry",
        // validUntil is set by the quote calculation (24 h, 72 h for furniture only); without it the shorter term.
        at: o.quote?.validUntil ?? after(now, s.shelfLifeHours.components * HOUR_MS),
      },
    ],
  }),
  rule({
    from: ["estimate_sent"],
    event: "EXPIRE",
    to: "estimate_expired",
    actors: ["system"],
    guard: ({ o, now }) => (expired(o, now) ? undefined : "invalid_transition"),
    effects: () => [notify("customer", "order.estimate_expired")],
  }),
  rule({
    from: ["estimate_sent", "estimate_expired"],
    event: "REVISE",
    to: "estimate_draft",
    actors: ["owner"],
  }),
  rule({
    from: ["estimate_sent"],
    event: "ACCEPT",
    to: "accepted",
    actors: ["customer"],
    guard: ({ o, e, now }) => {
      const q = o.quote;
      // A podbor order is delivered, not purchased: it never enters the purchase flow.
      if (q === undefined || q.id !== e.quoteId || o.kind === "podbor") return "invalid_transition";
      if (expired(o, now)) return "estimate_expired";
      const offers = offersGuard(o);
      if (offers !== undefined) return offers;
      // The event carries consent ids only; the kinds (pd_processing, supplier_data_transfer, non_returnable)
      // are verified by services.consents.record. The domain checks that enough distinct consents are named.
      const ids = Array.isArray(e.consentIds) ? e.consentIds.filter((id) => !blank(id)) : [];
      if (new Set(ids).size < BASE_CONSENTS + (q.hasNonReturnable ? 1 : 0)) return "consent_missing";
      return undefined;
    },
    effects: ({ o }) => [
      ...expectPayment("fee_advance", o.quote?.advance ?? asSum(0)),
      ...expectPayment("purchase_funds", o.quote?.purchaseLimit ?? asSum(0)),
      notify("customer", "order.accepted"),
    ],
  }),
  rule({
    from: ["accepted"],
    event: "FEE_PREPAID",
    to: "accepted",
    actors: ["owner"],
    guard: ({ o, e }) => {
      if (o.flags.feePrepaid) return "invalid_transition";
      return blank(e.paymentId) ? "payments_incomplete" : undefined;
    },
  }),
  rule({
    from: ["accepted"],
    event: "FUNDS_RECEIVED",
    to: "accepted",
    actors: ["owner"],
    guard: ({ o, e }) => {
      if (o.quote === undefined || o.flags.fundsReceived) return "invalid_transition";
      const named = Array.isArray(e.paymentIds) && e.paymentIds.some((id) => !blank(id));
      // money.fundsReceived is the confirmed sum of purchase_funds payments (bank_transfer_ip only, checked in services).
      return named && o.money.fundsReceived >= o.quote.purchaseLimit ? undefined : "payments_incomplete";
    },
    // Purchases start no earlier than the next working day after the money arrived.
    effects: ({ e, cal }) => [{ kind: "set", field: "purchaseNotBefore", at: cal.nextWorkingDayStart(e.receivedAt) }],
  }),
  rule({
    from: ["accepted"],
    event: "MEETING_DONE",
    to: "accepted",
    actors: ["owner"],
    guard: ({ o }) => (o.flags.firstOrderMeetingDone ? "invalid_transition" : undefined),
  }),
  rule({
    from: ["accepted"],
    event: "START_PURCHASE",
    to: "purchasing",
    actors: ["owner"],
    guard: ({ o, now }) => {
      if (!o.flags.feePrepaid || !o.flags.fundsReceived) return "payments_incomplete";
      if (o.purchaseNotBefore === undefined || now.getTime() < o.purchaseNotBefore.getTime()) {
        return "purchase_too_early";
      }
      if (o.firstOrderOfCustomer && o.grandTotal >= FIRST_ORDER_MEETING_FROM && !o.flags.firstOrderMeetingDone) {
        return "meeting_required";
      }
      return undefined;
    },
  }),
  rule({
    from: ["purchasing"],
    event: "PURCHASE_RECORDED",
    to: "purchasing",
    actors: ["owner", "assistant"],
    guard: ({ o }) => {
      if (o.quote === undefined) return "invalid_transition";
      // Receipts and photos (or the no_receipt_purchase consent) are checked by services.purchases.record.
      if (o.money.receiptsTotal > o.quote.purchaseLimit && !o.money.hasLimitOverrunConsent) return "limit_exceeded";
      // Never with our own money, even when the customer agreed to exceed the limit.
      if (o.money.receiptsTotal > o.money.fundsReceived) return "funds_exceeded";
      return undefined;
    },
    effects: () => [notify("customer", "order.purchase_recorded")],
  }),
  rule({
    from: ["purchasing"],
    event: "PURCHASE_DONE",
    to: "report_due",
    actors: ["owner"],
    guard: ({ o }) => (o.purchasesComplete ? undefined : "purchases_incomplete"),
    effects: ({ now }) => {
      const target = after(now, 24 * HOUR_MS);
      return [
        { kind: "set", field: "reportDueAt", at: target },
        // Target +24 h, hard deadline +48 h (CONCEPT: the report is due in 24-48 hours).
        { kind: "schedule", job: "report_due", at: target },
        { kind: "schedule", job: "report_due", at: after(now, 48 * HOUR_MS) },
      ];
    },
  }),
  rule({
    from: ["report_due"],
    event: "SEND_REPORT",
    to: "report_sent",
    actors: ["owner"],
    guard: ({ o }) => (o.purchasesComplete ? undefined : "purchases_incomplete"),
    effects: ({ o, now, cal }) => {
      const objectionUntil = cal.addWorkingDays(now, 3);
      const refundDueAt = cal.addWorkingDays(now, 5);
      const remainder = o.money.fundsReceived - o.money.receiptsTotal - o.money.refunded;
      return [
        { kind: "render_pdf", doc: "commission_report", watermarkDraft: false },
        { kind: "set", field: "objectionUntil", at: objectionUntil },
        { kind: "set", field: "refundDueAt", at: refundDueAt },
        { kind: "schedule", job: "objection_window", at: objectionUntil },
        { kind: "schedule", job: "refund_due", at: refundDueAt },
        ...expectPayment("remainder_refund", asSum(remainder)),
        notify("customer", "order.report_sent"),
      ];
    },
  }),
  rule({
    from: ["report_sent"],
    event: "OBJECTION",
    to: "report_sent",
    actors: ["customer"],
    // The window itself (objectionUntil) is not in the snapshot: after it the system sends REPORT_DEEMED_ACCEPTED,
    // and an objection to an accepted report is rejected here.
    guard: ({ o, e }) =>
      o.report === undefined || o.report.accepted || blank(e.text) ? "invalid_transition" : undefined,
    effects: () => [notify("owner_topic", "order.report_objection")],
  }),
  rule({
    from: ["report_sent"],
    event: "REPORT_ACCEPTED",
    to: "report_sent",
    actors: ["customer"],
    guard: ({ o }) => reportAcceptanceGuard(o),
  }),
  rule({
    from: ["report_sent"],
    event: "REPORT_DEEMED_ACCEPTED",
    to: "report_sent",
    actors: ["system"],
    // "The term has expired" is the job objection_window firing as the system actor.
    guard: ({ o }) => reportAcceptanceGuard(o),
  }),
  rule({
    from: ["report_sent"],
    event: "REMAINDER_SETTLED",
    to: "settled",
    actors: ["owner"],
    guard: ({ o }) => {
      if (o.report === undefined) return "invalid_transition";
      // Not accepted yet means the objection window is still open or an objection is pending.
      if (!o.report.accepted || o.report.objectionOpen) return "report_objection_open";
      // Funds received = receipts + refunded: the remainder has gone back (or there was none).
      return reconciled(o) ? undefined : "not_reconciled";
    },
    effects: ({ o }) => {
      const amount = receiptsReserve(o.money.receiptsTotal);
      return amount > 0 ? [{ kind: "ledger", fund: "tax_risk", amount }] : [];
    },
  }),
  rule({
    from: ["settled"],
    event: "MATERIALS_ACCEPTED",
    to: "assembling",
    actors: ["owner"],
    guard: ({ e }) => (blank(e.actId) ? "act_missing" : undefined),
  }),
  rule({
    from: ["assembling"],
    event: "ASSEMBLED",
    to: "testing",
    actors: ["owner", "assistant"],
    effects: () => [notify("customer", "order.assembly_photos")],
  }),
  rule({
    from: ["testing"],
    event: "TESTS_PASSED",
    to: "ready",
    actors: ["owner", "assistant"],
    // The 6-8 h protocol without errors is verified by services; the passport must exist.
    guard: ({ e }) => (blank(e.passportId) ? "passport_missing" : undefined),
    effects: () => [{ kind: "render_pdf", doc: "passport", watermarkDraft: false }, notify("customer", "order.ready")],
  }),
  rule({
    from: ["ready"],
    event: "DISPATCH",
    to: "delivering",
    actors: ["owner"],
    effects: () => [notify("customer", "order.delivering")],
  }),
  rule({
    from: ["delivering"],
    event: "HANDOVER",
    to: "handed_over",
    // The customer's button confirms the handover; the guards still demand the act and the confirmed final payment.
    actors: ["owner", "customer"],
    guard: ({ e }) => {
      if (blank(e.actId)) return "act_missing";
      return blank(e.finalPaymentId) ? "final_payment_missing" : undefined;
    },
    effects: ({ o, now }) => {
      const warrantyUntil = addMonthsTashkent(now, 12);
      return [
        { kind: "set", field: "warrantyUntil", at: warrantyUntil },
        { kind: "schedule", job: "warranty_end", at: warrantyUntil },
        { kind: "schedule", job: "aftercare", at: after(now, 7 * DAY_MS) },
        { kind: "schedule", job: "aftercare", at: after(now, 30 * DAY_MS) },
        { kind: "ledger", fund: "warranty", amount: warrantyReserve(o.money.receiptsTotal) },
        notify("customer", "order.handed_over"),
      ];
    },
  }),
  rule({
    from: ["handed_over"],
    event: "CLOSE",
    to: "closed",
    actors: ["system"],
    guard: ({ o }) => {
      if (o.report?.objectionOpen) return "report_objection_open";
      return reconciled(o) ? undefined : "not_reconciled";
    },
  }),
  rule({
    from: ["estimate_sent"],
    event: "PODBOR_DELIVERED",
    to: "podbor_delivered",
    actors: ["owner"],
    guard: ({ o, e }) => {
      if (o.kind !== "podbor") return "invalid_transition";
      const offers = offersGuard(o);
      if (offers !== undefined) return offers;
      return blank(e.paymentId) ? "payments_incomplete" : undefined;
    },
    effects: ({ now, s }) => [
      // The Podbor fee is credited when the customer orders within podborCreditDays; the aftercare job watches the term.
      { kind: "schedule", job: "aftercare", at: after(now, s.podborCreditDays * DAY_MS) },
      notify("customer", "order.podbor_delivered"),
    ],
  }),
  rule({
    from: CANCELLABLE,
    event: "CANCEL",
    to: "cancelling",
    actors: ["owner"],
    guard: ({ o, e }) => {
      if (e.settlement === undefined || blank(e.reason)) return "invalid_transition";
      // The settlement was calculated for a point; a point that does not fit the status means wrong money.
      return CANCEL_POINTS[e.point]?.includes(o.status) ? undefined : "invalid_transition";
    },
    effects: ({ e }) => [
      ...expectPayment("fee_refund", e.settlement.feeToRefund),
      // Extra fee: a separate QR payment with a receipt, never offset against purchase funds.
      ...expectPayment("fee_extra", e.settlement.feeToInvoice),
      ...expectPayment("funds_refund", e.settlement.fundsToRefund),
      { kind: "schedule", job: "refund_due", at: e.settlement.dueBy },
      { kind: "set", field: "refundDueAt", at: e.settlement.dueBy },
      notify("customer", "order.cancelling"),
      // Income adjustment (Tax Code art. 466) is a task for the accountant.
      notify("owner_topic", "accountant.income_adjustment"),
    ],
  }),
  rule({
    from: ["cancelling"],
    event: "CANCEL_SETTLED",
    to: "cancelled",
    actors: ["owner"],
    // That every expected payment is confirmed or voided with a reason is checked by services; here the money must
    // add up: the customer got back at least funds - receipts - documented losses (shop refunds only add to it).
    guard: ({ o }) => {
      const owed = o.money.fundsReceived - o.money.receiptsTotal - o.money.documentedLosses;
      return owed > 0 && o.money.refunded < owed ? "not_reconciled" : undefined;
    },
    effects: () => [notify("customer", "order.cancelled")],
  }),
];

function reportAcceptanceGuard(o: OrderSnapshot): GuardError | undefined {
  if (o.report === undefined || o.report.accepted) return "invalid_transition";
  return o.report.objectionOpen ? "report_objection_open" : undefined;
}
