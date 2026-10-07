// payment.expect (outbox/contract.ts): the site queues it after ACCEPT, SEND_REPORT, DISPATCH and CANCEL because it may neither write
// payments nor call sales.expect_payment. The payload names the order and the kind; the worker takes the sum from the accepted
// quote, the report or the settlement of the cancellation in the database (payments.expectFromJob), and a hint that is not
// that sum is refused. The database checks the pair kind and method, the order and a repeat (DATA-MAP 2).
import { DbRuleError } from "@nivel/db/repos";
import { orders, type payments } from "@nivel/services";
import type { Logger } from "pino";
import { PermanentJobError } from "../../queues/define.ts";

type ExpectFromJob = typeof payments.expectFromJob;

export interface PaymentExpectDeps {
  log: Logger;
  expectFromJob: (input: Parameters<ExpectFromJob>[0]) => ReturnType<ExpectFromJob>;
}

export type PaymentExpectResult = { paymentId: string; created: boolean } | { nothingToExpect: true };

/** Refusals of the scenario that a retry cannot mend. */
const REFUSED_BY_DATABASE = new Set(["invalid_payment", "order_not_found"]);

export async function handlePaymentExpect(
  deps: PaymentExpectDeps,
  data: Record<string, unknown>,
): Promise<PaymentExpectResult> {
  const { orderId, paymentKind, amountSum } = data;
  if (typeof orderId !== "string" || typeof paymentKind !== "string") {
    throw new PermanentJobError("payment.expect: the job must name the order and the kind of the payment");
  }
  if (amountSum !== undefined && !(typeof amountSum === "number" && Number.isSafeInteger(amountSum) && amountSum > 0)) {
    throw new PermanentJobError("payment.expect: the hint of the sum must be a whole positive sum");
  }
  try {
    const made = await deps.expectFromJob({ orderId, paymentKind, ...(amountSum === undefined ? {} : { amountSum }) });
    return made;
  } catch (error) {
    if (error instanceof orders.ValidationError) {
      if (error.issues.some((i) => i.code === "amount_zero")) {
        deps.log.info({ orderId, paymentKind }, "payment.expect: nothing to expect");
        return { nothingToExpect: true };
      }
      throw new PermanentJobError(`payment.expect refused: ${error.message}`);
    }
    if (
      error instanceof orders.NotFoundError ||
      error instanceof orders.ForbiddenError ||
      error instanceof orders.ConfigError
    ) {
      throw new PermanentJobError(`payment.expect refused: ${error.message}`);
    }
    if (error instanceof DbRuleError && REFUSED_BY_DATABASE.has(error.code)) {
      throw new PermanentJobError(`payment.expect refused by the database: ${error.message}`);
    }
    throw error;
  }
}
