// purchases.record (BUILD_PLAN WP-07, ARCHITECTURE 4.9): the owner or the assistant bought a position in a shop with the
// money of the customer. A receipt (fiscal) or an ESF WITH ITS PHOTO, or the consent `no_receipt_purchase`; never above
// the limit of the estimate without the consent `limit_overrun`, never above the money received (our own money does not
// pay for a customer). The purchase, the photos and the event PURCHASE_RECORDED stand or fall together.
import { purchaseFiles } from "@nivel/db";
import { DbRuleError, ops, sales } from "@nivel/db/repos";
import { addMonthsTashkent, isoDateInTashkent } from "@nivel/domain/calendar";
import type { GuardError, OrderStatus } from "@nivel/domain/order";
import { type ActorRef, checkActor, requireStaff } from "../orders/actor.ts";
import { dispatchInTx, inDispatchTransaction } from "../orders/dispatch.ts";
import { NotFoundError, ValidationError, type ValidationIssue } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { assertUuid, isUuid } from "../orders/validate.ts";

const MAX_QTY = 99;
const MAX_SUM = 1_000_000_000_000;
const DAY_MS = 86_400_000;
/** The ESF of a purchase is due ten calendar days after it (ARCHITECTURE 3.3, purchases.esf_due). */
const ESF_DAYS = 10;

export interface RecordPurchaseInput {
  orderId: string;
  vendorId: string;
  /** The line of the current quote this purchase covers; a purchase may also stand outside the quote (an extra). */
  quoteLineId?: string;
  productId?: string;
  qty: number;
  amountSum: number;
  discountSum?: number;
  paidVia: "corp_card" | "bank_transfer";
  receiptKind: "fiscal" | "esf" | "none_with_consent";
  receiptNo?: string;
  esfNo?: string;
  esfStatus?: "pending" | "signed" | "rejected";
  serials?: string[];
  vendorWarrantyMonths?: number;
  /** Registered files (ops.files): the photos of the receipt. */
  receiptFileIds: string[];
  boughtBy?: string;
}

export type RecordPurchaseResult =
  | { ok: true; status: OrderStatus; purchaseId: string }
  | { ok: false; error: GuardError };

function validate(i: RecordPurchaseInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bad = (path: string, code: string, message: string) => issues.push({ path, code, message });
  if (!Number.isSafeInteger(i.amountSum) || i.amountSum < 1 || i.amountSum > MAX_SUM) {
    bad("amountSum", "sum_invalid", `amountSum must be a whole number of sums from 1 to ${MAX_SUM}`);
  }
  if (!Number.isSafeInteger(i.qty) || i.qty < 1 || i.qty > MAX_QTY) {
    bad("qty", "qty_invalid", `qty must be a whole number from 1 to ${MAX_QTY}`);
  }
  if (
    i.discountSum !== undefined &&
    (!Number.isSafeInteger(i.discountSum) || i.discountSum < 0 || i.discountSum > MAX_SUM)
  ) {
    bad("discountSum", "sum_invalid", `discountSum must be a whole number of sums from 0 to ${MAX_SUM}`);
  }
  if (i.paidVia !== "corp_card" && i.paidVia !== "bank_transfer") {
    bad("paidVia", "paid_via_unknown", "paidVia must be corp_card or bank_transfer");
  }
  if (!["fiscal", "esf", "none_with_consent"].includes(i.receiptKind)) {
    bad("receiptKind", "receipt_kind_unknown", "receiptKind must be fiscal, esf or none_with_consent");
  }
  if (i.receiptKind === "fiscal" && (i.receiptNo ?? "").trim() === "") {
    bad("receiptNo", "receipt_no_required", "a fiscal receipt needs its number");
  }
  if (i.receiptKind === "esf" && i.esfStatus === undefined) {
    bad("esfStatus", "esf_status_required", "an ESF purchase needs the status of the document");
  }
  if (!Array.isArray(i.receiptFileIds)) {
    bad("receiptFileIds", "list_required", "receiptFileIds must be a list of file ids");
  } else if (i.receiptKind !== "none_with_consent" && i.receiptFileIds.length === 0) {
    bad(
      "receiptFileIds",
      "photo_required",
      "a purchase needs the photo of the receipt, or the consent of the customer to a purchase without one",
    );
  }
  if (i.serials !== undefined && (!Array.isArray(i.serials) || i.serials.length > i.qty)) {
    bad("serials", "serials_too_many", "there are more serial numbers than items bought");
  }
  if (
    i.vendorWarrantyMonths !== undefined &&
    (!Number.isSafeInteger(i.vendorWarrantyMonths) || i.vendorWarrantyMonths < 0 || i.vendorWarrantyMonths > 120)
  ) {
    bad("vendorWarrantyMonths", "months_invalid", "vendorWarrantyMonths must be a whole number from 0 to 120");
  }
  return issues;
}

export async function record(
  input: RecordPurchaseInput,
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<RecordPurchaseResult> {
  const r = runtimeOf(rt);
  const actor = checkActor(actorRef);
  requireStaff(actor, "recording a purchase");
  requireCapability(r, "purchases.write");
  const orderId = assertUuid(input.orderId, "orderId");
  const issues = validate(input);
  if (!isUuid(input.vendorId))
    issues.push({ path: "vendorId", code: "vendor_unknown", message: "the shop does not exist" });
  if (issues.length > 0) throw new ValidationError(issues);
  const now = r.now();

  let purchaseId: string | undefined;
  const result = await inDispatchTransaction(r, async (tx) => {
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");

    if (input.quoteLineId !== undefined) {
      const quote = order.currentQuoteId ? await sales.getQuote(tx, order.currentQuoteId) : null;
      if (!isUuid(input.quoteLineId) || !quote?.lines.some((l) => l.id === input.quoteLineId)) {
        throw ValidationError.of(
          "quoteLineId",
          "quote_line_unknown",
          "the line is not a line of the current quote of this order",
        );
      }
    }
    const vendor = await tx.query.vendors.findFirst({
      columns: { id: true },
      where: (t, { eq }) => eq(t.id, input.vendorId),
    });
    if (!vendor) throw ValidationError.of("vendorId", "vendor_unknown", "the shop does not exist");
    for (const fileId of input.receiptFileIds) {
      if (!isUuid(fileId) || !(await ops.getFile(tx, fileId))) {
        throw ValidationError.of("receiptFileIds", "file_unknown", `the file ${String(fileId)} is not registered`);
      }
    }
    if (input.receiptKind === "fiscal" && input.receiptNo) {
      const same = await tx.query.purchases.findFirst({
        columns: { id: true },
        where: (t, { and, eq, isNull }) =>
          and(
            eq(t.orderId, orderId),
            eq(t.vendorId, input.vendorId),
            eq(t.receiptNo, (input.receiptNo as string).trim()),
            isNull(t.refundOf),
          ),
      });
      if (same) {
        throw ValidationError.of(
          "receiptNo",
          "purchase_duplicate",
          "this receipt of this shop is already recorded for the order",
        );
      }
    }

    try {
      purchaseId = await sales.recordPurchase(tx, {
        orderId,
        vendorId: input.vendorId,
        quoteLineId: input.quoteLineId ?? null,
        productId: input.productId ?? null,
        qty: input.qty,
        amountSum: input.amountSum,
        discountSum: input.discountSum ?? 0,
        paidVia: input.paidVia,
        receiptKind: input.receiptKind,
        receiptNo: input.receiptNo?.trim() ?? null,
        esfNo: input.esfNo?.trim() ?? null,
        esfStatus: input.receiptKind === "esf" ? (input.esfStatus ?? null) : null,
        esfDue: input.receiptKind === "esf" ? isoDateInTashkent(new Date(now.getTime() + ESF_DAYS * DAY_MS)) : null,
        serials: input.serials ?? null,
        vendorWarrantyMonths: input.vendorWarrantyMonths ?? null,
        vendorWarrantyUntil:
          input.vendorWarrantyMonths === undefined
            ? null
            : isoDateInTashkent(addMonthsTashkent(now, input.vendorWarrantyMonths)),
        boughtBy: input.boughtBy?.trim() || actor.id,
      });
    } catch (e) {
      if (e instanceof DbRuleError && e.code === "no_current_quote") {
        throw ValidationError.of(
          "orderId",
          "no_current_quote",
          "the order has no quote: there is no limit to buy within",
        );
      }
      throw e;
    }
    if (input.receiptFileIds.length > 0) {
      await tx
        .insert(purchaseFiles)
        .values(
          input.receiptFileIds.map((fileId) => ({
            purchaseId: purchaseId as string,
            fileId,
            kind: "receipt" as const,
          })),
        );
    }
    const dispatched = await dispatchInTx(r, tx, orderId, { type: "PURCHASE_RECORDED", purchaseId }, actor);
    if (dispatched.ok) {
      await ops.enqueueOutbox(tx, {
        kind: "job",
        dedupeKey: `purchase:${purchaseId}:threshold`,
        payload: { job: "threshold.check", orderId, purchaseId },
      });
    }
    return dispatched;
  });
  return result.ok && purchaseId !== undefined ? { ...result, purchaseId } : (result as RecordPurchaseResult);
}
