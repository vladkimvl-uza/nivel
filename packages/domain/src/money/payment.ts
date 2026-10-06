// Payment pair rules: the first line of defence; the database CHECK (ARCHITECTURE 3.4) is the second.
// The two money flows never mix: the fee goes through Xolis QR (or a card merchant) with a fiscal receipt,
// purchase funds only by bank transfer to the IP account, refunds only as outgoing bank transfers.

export const PAYMENT_KINDS = [
  "fee_advance",
  "fee_final",
  "fee_extra",
  "podbor_fee",
  "purchase_funds",
  "purchase_topup",
  "remainder_refund",
  "fee_refund",
  "funds_refund",
] as const;
export const PAYMENT_DIRECTIONS = ["in", "out"] as const;
export const PAYMENT_METHODS = ["xolis_qr", "merchant_card", "bank_transfer_ip", "bank_transfer_out"] as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = "expected" | "confirmed" | "void";

export interface PaymentInput {
  kind: PaymentKind;
  direction: PaymentDirection;
  method: PaymentMethod;
  status?: PaymentStatus;
  fiscalReceiptNo?: string | null;
}

export type PaymentCheck =
  | { ok: true }
  | { ok: false; errorKey: "payment.kind_unknown" | "payment.pair_invalid" | "payment.receipt_required" };

const FEE_KINDS: readonly string[] = ["fee_advance", "fee_final", "fee_extra", "podbor_fee"];
const FUNDS_KINDS: readonly string[] = ["purchase_funds", "purchase_topup"];
const REFUND_KINDS: readonly string[] = ["remainder_refund", "fee_refund", "funds_refund"];

export function validatePayment(p: PaymentInput): PaymentCheck {
  if (FEE_KINDS.includes(p.kind)) {
    if (p.direction !== "in" || (p.method !== "xolis_qr" && p.method !== "merchant_card")) {
      return { ok: false, errorKey: "payment.pair_invalid" };
    }
    if (p.status === "confirmed" && (p.fiscalReceiptNo ?? "").trim() === "") {
      return { ok: false, errorKey: "payment.receipt_required" };
    }
    return { ok: true };
  }
  if (FUNDS_KINDS.includes(p.kind)) {
    return p.direction === "in" && p.method === "bank_transfer_ip"
      ? { ok: true }
      : { ok: false, errorKey: "payment.pair_invalid" };
  }
  if (REFUND_KINDS.includes(p.kind)) {
    return p.direction === "out" && p.method === "bank_transfer_out"
      ? { ok: true }
      : { ok: false, errorKey: "payment.pair_invalid" };
  }
  return { ok: false, errorKey: "payment.kind_unknown" };
}
