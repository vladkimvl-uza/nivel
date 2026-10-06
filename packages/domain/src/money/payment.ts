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

/** Every kind belongs to exactly one flow; the compiler refuses a kind without a group. */
const KIND_GROUP: Record<PaymentKind, "fee" | "funds" | "refund"> = {
  fee_advance: "fee",
  fee_final: "fee",
  fee_extra: "fee",
  podbor_fee: "fee",
  purchase_funds: "funds",
  purchase_topup: "funds",
  remainder_refund: "refund",
  fee_refund: "refund",
  funds_refund: "refund",
};

export function validatePayment(p: PaymentInput): PaymentCheck {
  const group = Object.hasOwn(KIND_GROUP, p.kind) ? KIND_GROUP[p.kind] : undefined;
  switch (group) {
    case "fee":
      if (p.direction !== "in" || (p.method !== "xolis_qr" && p.method !== "merchant_card")) {
        return { ok: false, errorKey: "payment.pair_invalid" };
      }
      if (p.status === "confirmed" && (p.fiscalReceiptNo ?? "").trim() === "") {
        return { ok: false, errorKey: "payment.receipt_required" };
      }
      return { ok: true };
    case "funds":
      return p.direction === "in" && p.method === "bank_transfer_ip"
        ? { ok: true }
        : { ok: false, errorKey: "payment.pair_invalid" };
    case "refund":
      return p.direction === "out" && p.method === "bank_transfer_out"
        ? { ok: true }
        : { ok: false, errorKey: "payment.pair_invalid" };
    default:
      return { ok: false, errorKey: "payment.kind_unknown" };
  }
}
