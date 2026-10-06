// Shared fixtures for the order automaton tests (not part of the public API). Not excluded from the coverage report: the coverage of WP-02 is quoted without this file.
import { createWorkCalendar } from "../calendar/index.ts";
import type { CancelPoint, CancelSettlement } from "../cancel/types.ts";
import type { FeeSettings } from "../fee/types.ts";
import type { Bp, Sum } from "../money/types.ts";
import type { Actor, OfferStatus, OrderEvent, OrderSnapshot, OrderStatus } from "./types.ts";

export const sum = (n: number): Sum => n as Sum;
const bp = (n: number): Bp => n as Bp;

/** Asia/Tashkent wall time to an instant (UTC+5, no daylight saving). */
export const tk = (iso: string): Date => new Date(`${iso}+05:00`);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Tuesday 2026-10-06 12:00 in Tashkent. 2026-10-13 (Tuesday) is a test holiday. */
export const NOW = tk("2026-10-06T12:00:00");
export const CAL = createWorkCalendar(["2026-10-13"], { from: "10:00", to: "19:00" });

export const SETTINGS: FeeSettings = {
  version: "test-1",
  effectiveFrom: "2026-10-05",
  pcLowRateBp: bp(1500),
  pcHighRateBp: bp(1000),
  pcThreshold: sum(20_000_000),
  pcHighMinFee: sum(3_000_000),
  mountRateBp: bp(1500),
  complexRateBp: bp(1500),
  minFullCyclePc: sum(6_700_000),
  minFreeWindowPc: sum(4_500_000),
  minFullCycleSetup: sum(13_300_000),
  stageSharesBp: { selection: bp(2000), purchase: bp(3000), assembly: bp(3500), handover: bp(1500) },
  commissionLineStages: ["selection", "purchase"],
  advanceBp: bp(3000),
  reserveBp: bp(300),
  reserveHighBp: bp(500),
  reserveHighShareBp: bp(2500),
  reserveRoundStep: 10_000,
  podborShareBp: bp(2000),
  podborCreditDays: 30,
  afterTestsRetainBp: bp(8500),
  shelfLifeHours: { components: 24, furniture: 72 },
};

type QuoteShape = NonNullable<OrderSnapshot["quote"]>;
/** Every field optional; `undefined` removes an optional field such as validUntil. */
type QuotePatch = { [K in keyof QuoteShape]?: QuoteShape[K] | undefined };
export interface OrderPatch {
  status?: OrderStatus;
  kind?: OrderSnapshot["kind"];
  flags?: Partial<OrderSnapshot["flags"]>;
  /** `null` removes the quote. */
  quote?: QuotePatch | null;
  money?: Partial<OrderSnapshot["money"]>;
  purchasesComplete?: boolean;
  /** `null` removes the report. */
  report?: Partial<NonNullable<OrderSnapshot["report"]>> | null;
  firstOrderOfCustomer?: boolean;
  grandTotal?: Sum;
  /** `null` removes the field. */
  purchaseNotBefore?: Date | null;
  offer?: Partial<Record<"uz" | "ru", OfferStatus>>;
  appMode?: OrderSnapshot["appMode"];
}

export const DEFAULT_QUOTE: NonNullable<OrderSnapshot["quote"]> = {
  id: "Q1",
  status: "sent",
  validUntil: new Date(NOW.getTime() + DAY),
  compatVerdict: "ok",
  manuallyChecked: true,
  eligibility: { mode: "full_cycle" },
  purchaseLimit: sum(10_300_000),
  advance: sum(900_000),
  final: sum(2_100_000),
  hasNonReturnable: false,
};

function mergeQuote(patch: QuotePatch | undefined): QuoteShape {
  const merged = { ...DEFAULT_QUOTE, ...patch } as QuotePatch;
  if (merged.validUntil === undefined) delete merged.validUntil;
  return merged as QuoteShape;
}

/** A production-mode PC order with published offers; every field can be patched. */
export function order(patch: OrderPatch = {}): OrderSnapshot {
  const quote: QuoteShape | undefined = patch.quote === null ? undefined : mergeQuote(patch.quote);
  const report =
    patch.report === null
      ? undefined
      : patch.report === undefined
        ? undefined
        : { accepted: false, objectionOpen: false, ...patch.report };
  const base: OrderSnapshot = {
    status: patch.status ?? "estimate_draft",
    kind: patch.kind ?? "pc",
    flags: { feePrepaid: false, fundsReceived: false, firstOrderMeetingDone: false, ...patch.flags },
    money: {
      fundsReceived: sum(0),
      receiptsTotal: sum(0),
      refunded: sum(0),
      documentedLosses: sum(0),
      hasLimitOverrunConsent: false,
      ...patch.money,
    },
    purchasesComplete: patch.purchasesComplete ?? false,
    firstOrderOfCustomer: patch.firstOrderOfCustomer ?? false,
    grandTotal: patch.grandTotal ?? sum(13_300_000),
    offer: { uz: "published", ru: "published", ...patch.offer },
    appMode: patch.appMode ?? "production",
  };
  if (quote) base.quote = quote;
  if (report) base.report = report;
  if (patch.purchaseNotBefore) base.purchaseNotBefore = patch.purchaseNotBefore;
  return base;
}

export const SETTLEMENT: CancelSettlement = {
  feeEarned: sum(600_000),
  feeToRefund: sum(300_000),
  feeToInvoice: sum(0),
  fundsToRefund: sum(10_300_000),
  partsGoTo: "none",
  dueBy: tk("2026-10-13T12:00:00"),
};

/** One valid sample payload per event type; the matrix tests need all 24 types. */
export const EVENTS: { [K in OrderEvent["type"]]: Extract<OrderEvent, { type: K }> } = {
  SEND_ESTIMATE: { type: "SEND_ESTIMATE", quoteId: "Q1", manuallyChecked: true },
  EXPIRE: { type: "EXPIRE" },
  REVISE: { type: "REVISE" },
  ACCEPT: { type: "ACCEPT", quoteId: "Q1", consentIds: ["c1", "c2"], channel: "bot" },
  FEE_PREPAID: { type: "FEE_PREPAID", paymentId: "p1" },
  FUNDS_RECEIVED: { type: "FUNDS_RECEIVED", paymentIds: ["p2"], receivedAt: tk("2026-10-06T11:00:00") },
  MEETING_DONE: { type: "MEETING_DONE" },
  START_PURCHASE: { type: "START_PURCHASE" },
  PURCHASE_RECORDED: { type: "PURCHASE_RECORDED", purchaseId: "pu1" },
  PURCHASE_DONE: { type: "PURCHASE_DONE" },
  SEND_REPORT: { type: "SEND_REPORT", reportId: "r1" },
  OBJECTION: { type: "OBJECTION", text: "The price of the SSD differs from the receipt" },
  REPORT_ACCEPTED: { type: "REPORT_ACCEPTED" },
  REPORT_DEEMED_ACCEPTED: { type: "REPORT_DEEMED_ACCEPTED" },
  REMAINDER_SETTLED: { type: "REMAINDER_SETTLED", refundPaymentId: "p3" },
  MATERIALS_ACCEPTED: { type: "MATERIALS_ACCEPTED", actId: "a1" },
  ASSEMBLED: { type: "ASSEMBLED" },
  TESTS_PASSED: { type: "TESTS_PASSED", passportId: "ps1" },
  DISPATCH: { type: "DISPATCH" },
  HANDOVER: { type: "HANDOVER", actId: "a2", finalPaymentId: "p4" },
  CLOSE: { type: "CLOSE" },
  PODBOR_DELIVERED: { type: "PODBOR_DELIVERED", paymentId: "p5" },
  CANCEL: { type: "CANCEL", point: "before_accept", reason: "Customer changed his mind", settlement: SETTLEMENT },
  CANCEL_SETTLED: { type: "CANCEL_SETTLED" },
};

export const ALL_EVENT_TYPES = Object.keys(EVENTS) as OrderEvent["type"][];
export const ALL_ACTORS: Actor[] = ["system", "customer", "owner", "assistant"];
export const ALL_STATUSES: OrderStatus[] = [
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
  "handed_over",
  "closed",
  "podbor_delivered",
  "cancelling",
  "cancelled",
];

/** The cancel point that matches a status (ARCHITECTURE 4.7). */
export const POINT_OF: Partial<Record<OrderStatus, CancelPoint>> = {
  estimate_draft: "before_accept",
  estimate_sent: "before_accept",
  estimate_expired: "before_accept",
  accepted: "after_accept_before_purchase",
  purchasing: "after_purchase_before_assembly",
  report_due: "after_purchase_before_assembly",
  report_sent: "after_purchase_before_assembly",
  settled: "after_purchase_before_assembly",
  assembling: "during_assembly",
  testing: "during_assembly",
  ready: "after_tests_before_handover",
  delivering: "after_tests_before_handover",
};
