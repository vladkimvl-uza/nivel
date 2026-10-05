// Frozen contract (ARCHITECTURE 4.7). Change only via ADR and a "contract" PR.
import type { FeeSettings } from "../fee/types.ts";
import type { Bp, Sum } from "../money/types.ts";
import type { WorkCalendar } from "../order/types.ts";

export type CancelPoint =
  | "before_accept"
  | "after_accept_before_purchase"
  | "after_purchase_before_assembly"
  | "during_assembly"
  | "after_tests_before_handover";
export interface CancelInput {
  point: CancelPoint;
  fee: Sum;
  feePaid: Sum;
  fundsReceived: Sum;
  receiptsTotal: Sum;
  shopRefunds: Sum;
  documentedLosses: Sum;
  assemblyDoneBp?: Bp; // assemblyDoneBp — owner input, journaled
}
export interface CancelSettlement {
  feeEarned: Sum; // by stage price list
  feeToRefund: Sum; // paid more than earned
  feeToInvoice: Sum; // earned more than paid: separate QR payment with receipt, never offset from purchase funds
  fundsToRefund: Sum; // fundsReceived − receiptsTotal + shopRefunds − documentedLosses
  partsGoTo: "none" | "client" | "shop_or_client";
  dueBy: Date; // +5 working days
}

export interface CancelApi {
  settleCancellation(i: CancelInput, s: FeeSettings, now: Date, cal: WorkCalendar): CancelSettlement;
}
