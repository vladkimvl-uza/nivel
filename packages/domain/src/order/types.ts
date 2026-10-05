// Frozen contract (ARCHITECTURE 4.9). Change only via ADR and a "contract" PR.
import type { CancelPoint, CancelSettlement } from "../cancel/types.ts";
import type { CompatResult } from "../compat/types.ts";
import type { Eligibility, FeeSettings } from "../fee/types.ts";
import type { IsoDate, Sum } from "../money/types.ts";

export type OrderStatus =
  | "estimate_draft"
  | "estimate_sent"
  | "estimate_expired"
  | "accepted" // offer + estimate accepted; waiting for 30 % fee and purchase funds (two flags)
  | "purchasing"
  | "report_due"
  | "report_sent"
  | "settled"
  | "assembling"
  | "testing"
  | "ready"
  | "delivering"
  | "handed_over"
  | "closed"
  | "podbor_delivered"
  | "cancelling"
  | "cancelled";
export type Actor = "system" | "customer" | "owner" | "assistant";
export type OrderEvent =
  | { type: "SEND_ESTIMATE"; quoteId: string; manuallyChecked: true }
  | { type: "EXPIRE" }
  | { type: "REVISE" }
  | { type: "ACCEPT"; quoteId: string; consentIds: string[]; channel: "bot" | "site" | "tma" }
  | { type: "FEE_PREPAID"; paymentId: string }
  | { type: "FUNDS_RECEIVED"; paymentIds: string[]; receivedAt: Date }
  | { type: "MEETING_DONE" }
  | { type: "START_PURCHASE" }
  | { type: "PURCHASE_RECORDED"; purchaseId: string }
  | { type: "PURCHASE_DONE" }
  | { type: "SEND_REPORT"; reportId: string }
  | { type: "OBJECTION"; text: string }
  | { type: "REPORT_ACCEPTED" }
  | { type: "REPORT_DEEMED_ACCEPTED" }
  | { type: "REMAINDER_SETTLED"; refundPaymentId?: string }
  | { type: "MATERIALS_ACCEPTED"; actId: string }
  | { type: "ASSEMBLED" }
  | { type: "TESTS_PASSED"; passportId: string }
  | { type: "DISPATCH" }
  | { type: "HANDOVER"; actId: string; finalPaymentId: string }
  | { type: "CLOSE" }
  | { type: "PODBOR_DELIVERED"; paymentId: string }
  | { type: "CANCEL"; point: CancelPoint; reason: string; settlement: CancelSettlement }
  | { type: "CANCEL_SETTLED" };
export type OfferStatus = "stub" | "lawyer_approved" | "published";
export interface OrderSnapshot {
  status: OrderStatus;
  kind: "pc" | "setup" | "podbor" | "upgrade";
  flags: { feePrepaid: boolean; fundsReceived: boolean; firstOrderMeetingDone: boolean };
  quote?: {
    id: string;
    status: string;
    validUntil?: Date;
    compatVerdict: CompatResult["verdict"];
    manuallyChecked: boolean;
    eligibility: Eligibility;
    purchaseLimit: Sum;
    advance: Sum;
    final: Sum;
    hasNonReturnable: boolean;
  };
  money: {
    fundsReceived: Sum;
    receiptsTotal: Sum;
    refunded: Sum;
    documentedLosses: Sum;
    hasLimitOverrunConsent: boolean;
  };
  purchasesComplete: boolean;
  report?: { accepted: boolean; objectionOpen: boolean };
  firstOrderOfCustomer: boolean;
  grandTotal: Sum;
  purchaseNotBefore?: Date;
  offer: { uz: OfferStatus; ru: OfferStatus };
  appMode: "development" | "staging" | "production";
}
export type Effect =
  | { kind: "notify"; to: "customer" | "owner_topic"; templateKey: string; params?: Record<string, string | number> }
  | {
      kind: "schedule";
      job: "estimate_expiry" | "report_due" | "objection_window" | "refund_due" | "warranty_end" | "aftercare";
      at: Date;
    }
  | {
      kind: "render_pdf";
      doc:
        | "quote"
        | "commission_report"
        | "act_materials"
        | "act_customer_parts"
        | "act_handover"
        | "passport"
        | "warranty";
      watermarkDraft: boolean;
    }
  | {
      kind: "expect_payment";
      paymentKind:
        | "fee_advance"
        | "purchase_funds"
        | "fee_final"
        | "fee_extra"
        | "remainder_refund"
        | "fee_refund"
        | "funds_refund";
      amount: Sum;
    }
  | { kind: "ledger"; fund: "warranty" | "tax_risk"; amount: Sum }
  | {
      kind: "set";
      field: "purchaseNotBefore" | "warrantyUntil" | "reportDueAt" | "objectionUntil" | "refundDueAt";
      at: Date;
    };
export type GuardError =
  | "actor_not_allowed"
  | "invalid_transition"
  | "estimate_expired"
  | "manual_check_missing"
  | "compat_block"
  | "not_eligible"
  | "offer_not_published"
  | "consent_missing"
  | "payments_incomplete"
  | "purchase_too_early"
  | "meeting_required"
  | "limit_exceeded"
  | "funds_exceeded"
  | "purchases_incomplete"
  | "not_reconciled"
  | "report_objection_open"
  | "final_payment_missing"
  | "act_missing"
  | "passport_missing";
export type TransitionResult = { ok: true; next: OrderStatus; effects: Effect[] } | { ok: false; error: GuardError };
/** Mon–Sat, UZ holidays, Asia/Tashkent, 10:00–19:00. */
export interface WorkCalendar {
  isWorkingDay(d: IsoDate): boolean;
  addWorkingDays(from: Date, n: number): Date;
  nextWorkingDayStart(from: Date): Date;
  isResponseHours(at: Date): boolean;
}
export type CustomerStatus =
  | "submitted"
  | "estimate_confirmed"
  | "prepaid"
  | "purchasing"
  | "receipts_summary"
  | "assembly_test"
  | "ready"
  | "handed_over"
  | "cancelled";

export interface OrderApi {
  transition(
    o: OrderSnapshot,
    e: OrderEvent,
    actor: Actor,
    now: Date,
    cal: WorkCalendar,
    s: FeeSettings,
  ): TransitionResult;
  customerStatus(s: OrderStatus): CustomerStatus;
}
