// payments.expectFromJob: the payments the site asked for. The site may neither write payments nor call the function of the
// database that expects them, so after ACCEPT, SEND_REPORT, DISPATCH and CANCEL through the site the scenario queues the
// job `payment.expect` { orderId, paymentKind, amountSum }. Its payload is a hint: this scenario, run by the worker (or by
// the bot), takes every sum from the quote, the report and the settlement of the cancellation kept in the database, and
// refuses a payload that names another one (outbox/contract.ts). Whatever status the order has must call for the payment.
import { type Executor, sales } from "@nivel/db/repos";
import type { OrderStatus } from "@nivel/domain/order";
import { NotFoundError, ValidationError } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import type { OrderRow } from "../orders/snapshot.ts";
import { assertUuid, assertWholeSum } from "../orders/validate.ts";

/** The kinds a job may ask for: the ones an event of the automaton expects. The rest (a top-up, the Podbor fee) the owner enters. */
const FROM_QUOTE = ["fee_advance", "purchase_funds", "fee_final"] as const;
const FROM_SETTLEMENT = ["fee_refund", "fee_extra", "funds_refund"] as const;
type JobKind = (typeof FROM_QUOTE)[number] | (typeof FROM_SETTLEMENT)[number] | "remainder_refund";
const JOB_KINDS: readonly string[] = [...FROM_QUOTE, ...FROM_SETTLEMENT, "remainder_refund"];

const AFTER_ACCEPT: readonly OrderStatus[] = [
  "accepted",
  "purchasing",
  "report_due",
  "report_sent",
  "settled",
  "assembling",
  "testing",
  "ready",
  "delivering",
  "handed_over",
];
/** The statuses in which each kind is called for (the events that expect it: ACCEPT, DISPATCH, SEND_REPORT, CANCEL). */
const STATUSES: Readonly<Record<JobKind, readonly OrderStatus[]>> = {
  fee_advance: AFTER_ACCEPT,
  purchase_funds: AFTER_ACCEPT,
  fee_final: ["delivering", "handed_over"],
  remainder_refund: ["report_sent", "settled"],
  fee_refund: ["cancelling", "cancelled"],
  fee_extra: ["cancelling", "cancelled"],
  funds_refund: ["cancelling", "cancelled"],
};

const isJobKind = (v: unknown): v is JobKind => typeof v === "string" && JOB_KINDS.includes(v);

export interface ExpectFromJobInput {
  orderId: string;
  /** The kind the job names; the sum is not taken from the job. */
  paymentKind: string;
  /** The sum the job names; it must be the sum computed here, or the job is refused. */
  amountSum?: number;
}

async function derive(tx: Executor, order: OrderRow, kind: JobKind): Promise<number> {
  if ((FROM_QUOTE as readonly string[]).includes(kind)) {
    const quote = order.currentQuoteId ? await sales.getQuote(tx, order.currentQuoteId) : null;
    // The customer must have accepted this very quote: the payments follow the acceptance.
    if (quote?.status !== "accepted") {
      throw ValidationError.of("orderId", "no_accepted_quote", `the order has no accepted quote: ${kind} has no sum`);
    }
    return kind === "fee_advance" ? quote.feeAdvance : kind === "fee_final" ? quote.feeFinal : quote.purchaseLimit;
  }
  if (kind === "remainder_refund") {
    const money = await sales.orderMoney(tx, order.id);
    return money.fundsReceived - money.receiptsTotal - money.refunded;
  }
  // The settlement of the cancellation was calculated by the server and kept in the order with the CANCEL event.
  const settlement = (order.cancel as { settlement?: Record<string, unknown> } | null)?.settlement;
  const field = kind === "fee_refund" ? "feeToRefund" : kind === "fee_extra" ? "feeToInvoice" : "fundsToRefund";
  const value = settlement?.[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw ValidationError.of(
      "orderId",
      "settlement_missing",
      `the order keeps no settlement of the cancellation with ${field}`,
    );
  }
  // What the owner has already confirmed of the settlement is paid: a job delivered again after that (a retry of the outbox)
  // finds nothing left, and the customer is not shown a second expectation of the same refund.
  return value - (await sales.confirmedSum(tx, order.id, [kind]));
}

/**
 * Expects the payment a job asked for, for the bot and the worker (the roles that may call sales.expect_payment). Answers
 * the id of the expectation and whether this call made it; a repeat of the job answers the same id. A sum of zero is
 * "nothing to expect" (`amount_zero`): a refund that has already been paid, a settlement without a debt.
 */
export async function expectFromJob(
  input: ExpectFromJobInput,
  rt?: Runtime,
): Promise<{ paymentId: string; created: boolean }> {
  const r = runtimeOf(rt);
  requireCapability(r, "payments.expect");
  const orderId = assertUuid(input.orderId, "orderId");
  if (!isJobKind(input.paymentKind)) {
    throw ValidationError.of(
      "paymentKind",
      "kind_not_derivable",
      `${String(input.paymentKind)} is not a payment that an event of the order expects: the owner enters it`,
    );
  }
  const kind = input.paymentKind;
  if (input.amountSum !== undefined) assertWholeSum(input.amountSum, "amountSum", 1);
  return r.db.transaction(async (tx) => {
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");
    if (!STATUSES[kind].includes(order.status)) {
      throw ValidationError.of(
        "paymentKind",
        "order_status",
        `${kind} is expected in the status ${STATUSES[kind].join(" or ")}, not ${order.status}`,
      );
    }
    const amount = await derive(tx, order, kind);
    if (amount <= 0) throw ValidationError.of("paymentKind", "amount_zero", `there is no sum of ${kind} to expect`);
    if (input.amountSum !== undefined && input.amountSum !== amount) {
      throw ValidationError.of(
        "amountSum",
        "amount_mismatch",
        `the sum of ${kind} is ${amount} by the data of the database, the job names ${input.amountSum}`,
      );
    }
    const made = await sales.expectPaymentAsRole(tx, { orderId, kind, amountSum: amount });
    return { paymentId: made.id, created: !made.duplicate };
  });
}
