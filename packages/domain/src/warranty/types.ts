// Contract derived from ARCHITECTURE 4.10 (prose only there); WP-02 may refine it via ADR before first use.
import type { WorkCalendar } from "../order/types.ts";

/** opened → diagnosing → (loaner_issued) → (at_supplier) → resolved | rejected → closed */
export type WarrantyStatus =
  | "opened"
  | "diagnosing"
  | "loaner_issued"
  | "at_supplier"
  | "resolved"
  | "rejected"
  | "closed";
/** Refusal only with a causal link: impact, liquid, overclocking, replacement by someone else. */
export type ClientFault = "impact" | "liquid" | "overclocking" | "third_party_replacement";
export type WarrantyEvent =
  | { type: "START_DIAGNOSIS" }
  | { type: "ISSUE_LOANER"; loanerItemId: string }
  | { type: "SEND_TO_SUPPLIER" }
  | { type: "RESOLVE" }
  | { type: "REJECT"; clientFault: ClientFault; evidence: string }
  | { type: "CLOSE" };
/** Deadlines from opened_at: reply 1 working day, diagnosis 2 working days, loaner 3 days, fix 10 working days (work) or 20 days (parts). */
export interface WarrantyDeadlines {
  reply: Date;
  diagnosis: Date;
  loaner: Date;
  fixWork: Date;
  fixParts: Date;
}
export type WarrantyGuardError = "invalid_transition" | "fault_evidence_missing";
export type WarrantyTransitionResult = { ok: true; next: WarrantyStatus } | { ok: false; error: WarrantyGuardError };

export interface WarrantyApi {
  warrantyTransition(status: WarrantyStatus, e: WarrantyEvent): WarrantyTransitionResult;
  warrantyDeadlines(openedAt: Date, cal: WorkCalendar): WarrantyDeadlines;
}
