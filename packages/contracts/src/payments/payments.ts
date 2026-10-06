// Inputs of `services.payments.expect|confirm|void` (WP-07). The pair "kind x method x direction" follows the domain
// rule `validatePayment` and the CHECKs of the database: the QR with a receipt for the fee, a transfer to the account of
// the sole proprietor for purchase funds, an outgoing transfer for refunds. The two money flows never mix.
import {
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  type PaymentDirection,
  type PaymentKind,
  type PaymentMethod,
  validatePayment,
} from "@nivel/domain/money";
import { z } from "zod";
import { InstantSchema, MAX_SUM, textUpTo, UuidSchema } from "../orders/common.ts";

export const MAX_PAYMENT_SUM = MAX_SUM;

/** The usual way each kind is paid; a fee may also go through the card of the merchant. */
export const DEFAULT_PAYMENT_PAIR: Readonly<
  Record<PaymentKind, { direction: PaymentDirection; method: PaymentMethod }>
> = {
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

const amount = z
  .number({ error: "Amount must be a number" })
  .int({ error: "Amount must be a whole number of sums" })
  .min(1, { error: "Amount must be positive" })
  .max(MAX_PAYMENT_SUM, { error: `Amount must not exceed ${MAX_PAYMENT_SUM} sums` });

export const ExpectPaymentInputSchema = z
  .strictObject({
    orderId: UuidSchema,
    kind: z.enum(PAYMENT_KINDS),
    amountSum: amount,
    method: z.enum(PAYMENT_METHODS).exactOptional(),
    payerIsCustomer: z.boolean().exactOptional(),
  })
  .transform((v, ctx) => {
    const pair = DEFAULT_PAYMENT_PAIR[v.kind];
    const method = v.method ?? pair.method;
    const check = validatePayment({ kind: v.kind, direction: pair.direction, method });
    if (!check.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: `Payment kind ${v.kind} cannot be paid by ${method} (${check.errorKey})`,
      });
      return z.NEVER;
    }
    return { ...v, direction: pair.direction, method };
  });

export const ConfirmPaymentInputSchema = z.strictObject({
  paymentId: UuidSchema,
  fiscalReceiptNo: textUpTo(64).exactOptional(),
  bankDocNo: textUpTo(64).exactOptional(),
  payerIsCustomer: z.boolean().exactOptional(),
  thirdPartyStatementFileId: UuidSchema.exactOptional(),
  at: InstantSchema.exactOptional(),
});

export const VoidPaymentInputSchema = z.strictObject({
  paymentId: UuidSchema,
  /** A payment is voided with a reason that goes to the audit log. */
  reason: textUpTo(500),
});

export type ExpectPaymentInput = z.output<typeof ExpectPaymentInputSchema>;
export type ConfirmPaymentInput = z.output<typeof ConfirmPaymentInputSchema>;
export type VoidPaymentInput = z.output<typeof VoidPaymentInputSchema>;
