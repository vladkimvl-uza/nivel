// The usual pair "direction x method" of every payment kind (ARCHITECTURE 3.4): the fee goes through the QR of Xolis with
// a receipt, the money for purchases only by bank transfer to the account of the sole proprietor, every refund as an
// outgoing bank transfer. The two money flows never mix: the database has CHECKs for the same pairs.
import { PAYMENT_KINDS, type PaymentDirection, type PaymentKind, type PaymentMethod } from "@nivel/domain/money";

export const PAYMENT_PAIRS: Readonly<Record<PaymentKind, { direction: PaymentDirection; method: PaymentMethod }>> = {
  fee_advance: { direction: "in", method: "xolis_qr" },
  fee_final: { direction: "in", method: "xolis_qr" },
  fee_extra: { direction: "in", method: "xolis_qr" },
  podbor_fee: { direction: "in", method: "xolis_qr" },
  purchase_funds: { direction: "in", method: "bank_transfer_ip" },
  purchase_topup: { direction: "in", method: "bank_transfer_ip" },
  remainder_refund: { direction: "out", method: "bank_transfer_out" },
  fee_refund: { direction: "out", method: "bank_transfer_out" },
  funds_refund: { direction: "out", method: "bank_transfer_out" },
};

export const FEE_KINDS: readonly PaymentKind[] = ["fee_advance", "fee_final", "fee_extra", "podbor_fee"];
export const FUNDS_KINDS: readonly PaymentKind[] = ["purchase_funds", "purchase_topup"];
export const REFUND_KINDS: readonly PaymentKind[] = ["remainder_refund", "fee_refund", "funds_refund"];

export const isPaymentKind = (v: unknown): v is PaymentKind => (PAYMENT_KINDS as readonly unknown[]).includes(v);
