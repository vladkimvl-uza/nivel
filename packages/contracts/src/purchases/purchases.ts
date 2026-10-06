// Input of `services.purchases.record` (WP-07): a purchase of the sole proprietor in a shop, from the money of the
// customer. A receipt (fiscal or ESF) with the photo of it, or the consent `no_receipt_purchase` (ARCHITECTURE 4.9).
import { z } from "zod";
import { MAX_SUM, textUpTo, UuidSchema } from "../orders/common.ts";

export const MAX_PURCHASE_SUM = MAX_SUM;
/** Same bound as the quantity of a line of a build (MAX_LINE_QTY of the compatibility module). */
const MAX_PURCHASE_QTY = 99;

export const RECEIPT_KINDS = ["fiscal", "esf", "none_with_consent"] as const;

export const RecordPurchaseInputSchema = z
  .strictObject({
    orderId: UuidSchema,
    vendorId: UuidSchema,
    quoteLineId: UuidSchema.exactOptional(),
    productId: UuidSchema.exactOptional(),
    qty: z.number().int().min(1).max(MAX_PURCHASE_QTY),
    amountSum: z
      .number({ error: "Amount must be a number" })
      .int({ error: "Amount must be a whole number of sums" })
      .min(1, { error: "Amount must be positive" })
      .max(MAX_PURCHASE_SUM, { error: `Amount must not exceed ${MAX_PURCHASE_SUM} sums` }),
    discountSum: z.number().int().min(0).max(MAX_PURCHASE_SUM).exactOptional(),
    paidVia: z.enum(["corp_card", "bank_transfer"]),
    receiptKind: z.enum(RECEIPT_KINDS),
    receiptNo: textUpTo(64).exactOptional(),
    esfNo: textUpTo(64).exactOptional(),
    esfStatus: z.enum(["pending", "signed", "rejected"]).exactOptional(),
    serials: z.array(textUpTo(64)).max(MAX_PURCHASE_QTY).exactOptional(),
    vendorWarrantyMonths: z.number().int().min(0).max(120).exactOptional(),
    /** Photos of the receipt, registered files (ops.files). */
    receiptFileIds: z.array(UuidSchema).max(10).default([]),
    boughtBy: textUpTo(64).exactOptional(),
  })
  .superRefine((p, ctx) => {
    if (p.receiptKind === "fiscal" && p.receiptNo === undefined) {
      ctx.addIssue({ code: "custom", path: ["receiptNo"], message: "A fiscal receipt needs its number" });
    }
    if (p.receiptKind === "esf" && p.esfStatus === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["esfStatus"],
        message: "An ESF purchase needs the status of the document",
      });
    }
    if (p.receiptKind !== "none_with_consent" && p.receiptFileIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["receiptFileIds"],
        message: "A purchase needs the photo of the receipt or the consent of the customer to a purchase without one",
      });
    }
    if (p.serials !== undefined && p.serials.length > p.qty) {
      ctx.addIssue({ code: "custom", path: ["serials"], message: "There are more serial numbers than items bought" });
    }
  });

export type RecordPurchaseInput = z.output<typeof RecordPurchaseInputSchema>;
