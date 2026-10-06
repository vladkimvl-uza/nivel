// payments.expect | confirm | void | reverse (BUILD_PLAN WP-07, ARCHITECTURE 3.4, 4.6). A payment is a row of a journal:
// an expectation (`expected`), then confirmed with the proof (a fiscal receipt for the fee, a bank document for the
// funds) or voided with a reason; a mistake in a confirmed payment is corrected by a row of the negative amount.
// The two money flows never mix: the fee only through the QR with a receipt, the money for purchases only by transfer to
// the account of the sole proprietor, refunds only as outgoing transfers. The amounts the quote fixes come from the quote.
import { DbRuleError, type Executor, guarded, ops, sales } from "@nivel/db/repos";
import { podborFee } from "@nivel/domain/fee";
import { type PaymentKind, validatePayment } from "@nivel/domain/money";
import { type ActorRef, auditActor, checkActor } from "../orders/actor.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { loadFeeSettings } from "../orders/settings.ts";
import { assertInstant, assertText, assertUuid, assertWholeSum } from "../orders/validate.ts";
import { OUTBOX_JOB } from "../outbox/contract.ts";
import { readStoredTotals } from "../quotes/stored.ts";
import { FEE_KINDS, isPaymentKind, PAYMENT_PAIRS } from "./pairs.ts";

/** Money is the owner's: the assistant never expects, confirms, voids or reverses a payment (ARCHITECTURE 4.9). */
function requireOwner(actorRef: ActorRef): ActorRef {
  const actor = checkActor(actorRef);
  if (actor.kind !== "owner")
    throw new ForbiddenError(`payments are the business of the owner, not of the ${actor.kind}`);
  return actor;
}

export interface ExpectPaymentInput {
  orderId: string;
  kind: PaymentKind;
  /** Omitted for the kinds the quote fixes (advance, final part, purchase funds): the amount of the quote is used. */
  amountSum?: number;
  /** A fee may also go through the card of the merchant; every other kind has one way. */
  method?: "xolis_qr" | "merchant_card" | "bank_transfer_ip" | "bank_transfer_out";
  payerIsCustomer?: boolean;
}

export interface ConfirmPaymentInput {
  paymentId: string;
  fiscalReceiptNo?: string;
  bankDocNo?: string;
  payerIsCustomer?: boolean;
  thirdPartyStatementFileId?: string;
  at?: Date;
}

function threshold(tx: Executor, orderId: string, paymentId: string) {
  // "After a payment or a receipt" the worker recounts the threshold (ARCHITECTURE 9, threshold.check).
  return ops.enqueueOutbox(tx, {
    kind: "job",
    dedupeKey: `payment:${paymentId}:threshold`,
    payload: { job: OUTBOX_JOB.THRESHOLD_CHECK, orderId, paymentId },
  });
}

/**
 * Takes the lock of the order of a payment, the one `dispatch` and `expect` take, and only then lets the caller read the
 * payment: two presses on one payment are served one after the other, and the second sees what the first has done.
 * A payment that does not exist takes no lock; the caller answers "not found".
 */
async function lockPaymentOrder(tx: Executor, paymentId: string): Promise<void> {
  const row = await tx.query.payments.findFirst({
    columns: { orderId: true },
    where: (t, { eq }) => eq(t.id, paymentId),
  });
  if (row) await lockBy(tx, `order:${row.orderId}`);
}

export async function expect(
  input: ExpectPaymentInput,
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<{ paymentId: string }> {
  const r = runtimeOf(rt);
  const actor = requireOwner(actorRef);
  requireCapability(r, "payments.write");
  const orderId = assertUuid(input.orderId, "orderId");
  if (!isPaymentKind(input.kind)) {
    throw ValidationError.of("kind", "kind_unknown", `the payment kind ${String(input.kind)} does not exist`);
  }
  const kind = input.kind;
  const pair = PAYMENT_PAIRS[kind];
  const method = input.method ?? pair.method;
  const check = validatePayment({ kind, direction: pair.direction, method });
  if (!check.ok) {
    throw ValidationError.of("method", "pair_invalid", `${kind} cannot be paid by ${method} (${check.errorKey})`);
  }
  return r.db.transaction(async (tx) => {
    // Two requests about one order wait for each other: the second one finds the expectation of the first.
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");
    const quote = order.currentQuoteId ? await sales.getQuote(tx, order.currentQuoteId) : null;
    // The Podbor fee is a share of the fee of the quote, counted by the domain from the settings of the owner.
    const podbor =
      kind === "podbor_fee" && quote
        ? podborFee(readStoredTotals(quote.totals).totals.fee, await loadFeeSettings(tx))
        : undefined;
    const fromQuote =
      kind === "fee_advance"
        ? quote?.feeAdvance
        : kind === "fee_final"
          ? quote?.feeFinal
          : kind === "purchase_funds"
            ? quote?.purchaseLimit
            : podbor;
    const fixedByQuote =
      kind === "fee_advance" || kind === "fee_final" || kind === "purchase_funds" || kind === "podbor_fee";
    if (fixedByQuote && fromQuote === undefined) {
      throw ValidationError.of("orderId", "no_quote", `the order has no quote: the amount of ${kind} is not known`);
    }
    if (input.amountSum !== undefined) assertWholeSum(input.amountSum, "amountSum", 1);
    if (fromQuote !== undefined && input.amountSum !== undefined && input.amountSum !== fromQuote) {
      throw ValidationError.of(
        "amountSum",
        "amount_mismatch",
        `the amount of ${kind} is fixed by the quote (${fromQuote}), got ${input.amountSum}`,
      );
    }
    const amount = fromQuote ?? input.amountSum;
    if (amount === undefined) throw ValidationError.of("amountSum", "sum_invalid", `${kind} needs an amount`);
    assertWholeSum(amount, "amountSum", 1);

    // A repeated request returns the expectation that is already there. For the kinds the quote fixes it is also the
    // payment that has been made since and not taken back: such a sum is expected once. The other kinds may repeat the
    // same sum (two refunds of one amount), so only an expectation that is still open counts for them.
    const found = await tx.query.payments.findMany({
      columns: { id: true, status: true, amountSum: true },
      where: (t, { and, eq, inArray, isNull }) =>
        and(
          eq(t.orderId, orderId),
          eq(t.kind, kind),
          eq(t.amountSum, amount),
          inArray(t.status, fixedByQuote ? ["expected", "confirmed"] : ["expected"]),
          isNull(t.reversalOf),
        ),
      orderBy: (t, { asc }) => asc(t.createdAt),
    });
    const confirmedIds = found.filter((p) => p.status === "confirmed").map((p) => p.id);
    const reversals =
      confirmedIds.length === 0
        ? []
        : await tx.query.payments.findMany({
            columns: { reversalOf: true, amountSum: true },
            where: (t, { and, eq, inArray }) => and(inArray(t.reversalOf, confirmedIds), eq(t.status, "confirmed")),
          });
    const standing = found.find(
      (p) =>
        p.status === "expected" ||
        p.amountSum + reversals.filter((x) => x.reversalOf === p.id).reduce((n, x) => n + x.amountSum, 0) > 0,
    );
    if (standing) return { paymentId: standing.id };

    const paymentId = await sales.expectPayment(tx, {
      orderId,
      kind,
      direction: pair.direction,
      method,
      amountSum: amount,
      ...(input.payerIsCustomer === undefined ? {} : { payerIsCustomer: input.payerIsCustomer }),
    });
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "payment.expect",
      entity: "sales.payments",
      entityId: paymentId,
      after: { orderId, kind, amountSum: amount },
    });
    return { paymentId };
  });
}

export async function confirm(
  input: ConfirmPaymentInput,
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<{ paymentId: string; kind: PaymentKind; amountSum: number }> {
  const r = runtimeOf(rt);
  const actor = requireOwner(actorRef);
  requireCapability(r, "payments.write");
  const paymentId = assertUuid(input.paymentId, "paymentId");
  const now = r.now();
  const at = input.at === undefined ? now : assertInstant(input.at, "at");
  if (at.getTime() > now.getTime()) {
    throw ValidationError.of("at", "date_in_future", "a payment cannot be confirmed with a time that has not come yet");
  }
  return r.db.transaction(async (tx) => {
    await lockPaymentOrder(tx, paymentId);
    const payment = await tx.query.payments.findFirst({ where: (t, { eq }) => eq(t.id, paymentId) });
    if (!payment) throw new NotFoundError("payment");
    if (payment.status !== "expected") {
      throw ValidationError.of(
        "paymentId",
        "payment_not_expected",
        `the payment is ${payment.status}: only an expected payment can be confirmed`,
      );
    }
    const receipt = input.fiscalReceiptNo?.trim();
    const check = validatePayment({
      kind: payment.kind,
      direction: payment.direction,
      method: payment.method,
      status: "confirmed",
      fiscalReceiptNo: receipt ?? null,
    });
    if (!check.ok) {
      const code = check.errorKey.replace("payment.", "");
      throw ValidationError.of("fiscalReceiptNo", code, `${payment.kind} cannot be confirmed: ${check.errorKey}`);
    }
    const payerIsCustomer = input.payerIsCustomer ?? payment.payerIsCustomer;
    if (!payerIsCustomer) {
      if (input.thirdPartyStatementFileId === undefined) {
        throw ValidationError.of(
          "thirdPartyStatementFileId",
          "statement_required",
          "the money of a person who is not the customer is taken only with the written statement of that person",
        );
      }
      const fileId = assertUuid(input.thirdPartyStatementFileId, "thirdPartyStatementFileId");
      if (!(await ops.getFile(tx, fileId))) {
        throw ValidationError.of(
          "thirdPartyStatementFileId",
          "file_unknown",
          "the file of the statement does not exist",
        );
      }
    }
    const confirmed = await guarded(() =>
      sales.confirmPayment(tx, paymentId, {
        by: auditActor(actor),
        at,
        ...(receipt ? { fiscalReceiptNo: receipt } : {}),
        ...(input.bankDocNo ? { bankDocNo: input.bankDocNo.trim() } : {}),
        payerIsCustomer,
        ...(input.thirdPartyStatementFileId ? { thirdPartyStatementFileId: input.thirdPartyStatementFileId } : {}),
      }),
    );
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "payment.confirm",
      entity: "sales.payments",
      entityId: paymentId,
      before: { status: "expected" },
      after: { status: "confirmed", kind: payment.kind, amountSum: payment.amountSum },
    });
    await threshold(tx, payment.orderId, paymentId);
    return { paymentId, kind: confirmed.kind, amountSum: confirmed.amountSum };
  });
}

/** An expected payment that will not come: voided with a reason that goes to the audit log. */
export async function voidPayment(
  input: { paymentId: string; reason: string },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<void> {
  const r = runtimeOf(rt);
  const actor = requireOwner(actorRef);
  requireCapability(r, "payments.write");
  const paymentId = assertUuid(input.paymentId, "paymentId");
  const reason = assertText(input.reason, "reason", 500);
  await r.db.transaction(async (tx) => {
    await lockPaymentOrder(tx, paymentId);
    const payment = await tx.query.payments.findFirst({
      columns: { id: true, status: true, kind: true, orderId: true },
      where: (t, { eq }) => eq(t.id, paymentId),
    });
    if (!payment) throw new NotFoundError("payment");
    if (payment.status !== "expected") {
      throw ValidationError.of(
        "paymentId",
        "payment_not_expected",
        `the payment is ${payment.status}: only an expected payment can be voided`,
      );
    }
    await sales.voidPayment(tx, paymentId);
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "payment.void",
      entity: "sales.payments",
      entityId: paymentId,
      before: { status: "expected" },
      after: { reason },
    });
  });
}

/** Corrects a confirmed payment with a confirmed row of the negative amount (the whole payment, or `amountSum`). */
export async function reverse(
  input: { paymentId: string; reason: string; amountSum?: number; fiscalReceiptNo?: string; bankDocNo?: string },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<{ reversalId: string }> {
  const r = runtimeOf(rt);
  const actor = requireOwner(actorRef);
  requireCapability(r, "payments.write");
  const paymentId = assertUuid(input.paymentId, "paymentId");
  const reason = assertText(input.reason, "reason", 500);
  if (input.amountSum !== undefined) assertWholeSum(input.amountSum, "amountSum", 1);
  const now = r.now();
  return r.db.transaction(async (tx) => {
    await lockPaymentOrder(tx, paymentId);
    const payment = await tx.query.payments.findFirst({ where: (t, { eq }) => eq(t.id, paymentId) });
    if (!payment) throw new NotFoundError("payment");
    if (payment.status !== "confirmed" || payment.reversalOf !== null) {
      throw ValidationError.of("paymentId", "payment_not_confirmed", "only a confirmed payment can be corrected");
    }
    const receipt = input.fiscalReceiptNo?.trim();
    if (FEE_KINDS.includes(payment.kind) && !receipt) {
      throw ValidationError.of(
        "fiscalReceiptNo",
        "receipt_required",
        "the correction of a fee needs the number of its receipt",
      );
    }
    let reversalId: string;
    try {
      reversalId = await sales.reversePayment(tx, paymentId, {
        by: auditActor(actor),
        at: now,
        ...(input.amountSum === undefined ? {} : { amountSum: input.amountSum }),
        ...(receipt ? { fiscalReceiptNo: receipt } : {}),
        ...(input.bankDocNo ? { bankDocNo: input.bankDocNo.trim() } : {}),
      });
    } catch (e) {
      if (e instanceof DbRuleError && e.code === "invalid_reversal") {
        throw ValidationError.of("amountSum", "invalid_reversal", e.message);
      }
      throw e;
    }
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "payment.reverse",
      entity: "sales.payments",
      entityId: reversalId,
      before: { paymentId, kind: payment.kind },
      after: { reason, amountSum: input.amountSum ?? payment.amountSum },
    });
    await threshold(tx, payment.orderId, reversalId);
    return { reversalId };
  });
}
