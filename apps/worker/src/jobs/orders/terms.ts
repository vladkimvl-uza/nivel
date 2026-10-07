// The terms of an order (ARCHITECTURE 4.9, 9; ADR-007 item 3):
//  - the report goes out, the customer has until `objectionUntil` to object; silence after that is acceptance, and the worker
//    says it as the system with REPORT_DEEMED_ACCEPTED, strictly after the end of the window (not at the very moment it ends);
//  - an estimate that nobody accepted expires after the `validUntil` of its quote (EXPIRE as the system);
//  - a day after ACCEPT the customer who has not paid is reminded.
// Statuses change only through `orders.dispatch`; this file decides when to ask and treats the answer of the automaton as final.
import type { ops } from "@nivel/db/repos";
import type { GuardError, OrderStatus } from "@nivel/domain/order";
import type { Logger } from "pino";
import type { JobSink } from "../../queues/runtime.ts";
import { QUEUE } from "../outbox/routes.ts";
import type { OrderFacts, OrdersStore } from "./store.ts";

export type SystemEvent = { type: "REPORT_DEEMED_ACCEPTED" } | { type: "EXPIRE" };

export interface TermsDeps {
  now(): Date;
  log: Logger;
  store: OrdersStore;
  /** `orders.dispatch` as the system actor. */
  dispatch(
    orderId: string,
    event: SystemEvent,
  ): Promise<{ ok: true; status: OrderStatus } | { ok: false; error: GuardError }>;
  enqueue(input: ops.OutboxInput): Promise<unknown>;
  jobs: Pick<JobSink, "send">;
}

const SWEEP_LIMIT = 100;
const RETRY_AFTER_MS = 1000;

/** Sends a job of the order calendar to come back at `at`: the term has not ended by the clock of this process yet. */
async function comeBackAt(deps: TermsDeps, job: string, order: OrderFacts, at: Date): Promise<void> {
  const when = new Date(at.getTime() + RETRY_AFTER_MS);
  await deps.jobs.send(
    QUEUE.ordersScheduled,
    { job, orderId: order.id, orderNumber: order.number, at: when.toISOString() },
    { singletonKey: `${job}:${order.id}:${when.getTime()}`, startAfter: when },
  );
}

// ---- REPORT_DEEMED_ACCEPTED ----------------------------------------------------------------------------------------------

export type DeemedOutcome = "accepted" | "too_early" | "objection_open" | "not_applicable";

export async function deemAccepted(deps: TermsDeps, orderId: string): Promise<{ outcome: DeemedOutcome }> {
  const order = await deps.store.order(orderId);
  // No window means no term to run out: the automaton never deems such a report accepted either.
  if (order === null || order.status !== "report_sent" || order.objectionUntil === null) {
    return { outcome: "not_applicable" };
  }
  const now = deps.now();
  if (now.getTime() <= order.objectionUntil.getTime()) {
    await comeBackAt(deps, "objection_window", order, order.objectionUntil);
    return { outcome: "too_early" };
  }
  const result = await deps.dispatch(orderId, { type: "REPORT_DEEMED_ACCEPTED" });
  if (result.ok) {
    deps.log.info(
      { orderId, number: order.number },
      "the report is deemed accepted: the window of objections has ended",
    );
    return { outcome: "accepted" };
  }
  // An open objection waits for the answer of the owner; the sweep takes the order again once it is answered.
  if (result.error === "report_objection_open") return { outcome: "objection_open" };
  // The report is accepted already, or the order has gone on: nothing to say.
  if (result.error === "invalid_transition") return { outcome: "not_applicable" };
  throw new Error(`REPORT_DEEMED_ACCEPTED of ${order.number} was refused: ${result.error}`);
}

export async function sweepDeemed(deps: TermsDeps): Promise<Record<DeemedOutcome | "failed", number>> {
  const count: Record<DeemedOutcome | "failed", number> = {
    accepted: 0,
    too_early: 0,
    objection_open: 0,
    not_applicable: 0,
    failed: 0,
  };
  for (const id of await deps.store.deemedCandidates(deps.now(), SWEEP_LIMIT)) {
    try {
      count[(await deemAccepted(deps, id)).outcome] += 1;
    } catch (error) {
      count.failed += 1;
      deps.log.error(
        { orderId: id, err: error instanceof Error ? error.message : String(error) },
        "REPORT_DEEMED_ACCEPTED failed",
      );
    }
  }
  return count;
}

// ---- EXPIRE ----------------------------------------------------------------------------------------------------------------

export type ExpiryOutcome = "expired" | "too_early" | "not_applicable";

export async function expireEstimate(deps: TermsDeps, orderId: string): Promise<{ outcome: ExpiryOutcome }> {
  const order = await deps.store.order(orderId);
  if (order === null || order.status !== "estimate_sent") return { outcome: "not_applicable" };
  const validUntil = await deps.store.quoteValidUntil(orderId);
  if (validUntil === null) return { outcome: "not_applicable" };
  if (deps.now().getTime() <= validUntil.getTime()) {
    await comeBackAt(deps, "estimate_expiry", order, validUntil);
    return { outcome: "too_early" };
  }
  const result = await deps.dispatch(orderId, { type: "EXPIRE" });
  if (result.ok) {
    deps.log.info({ orderId, number: order.number }, "the estimate has expired");
    return { outcome: "expired" };
  }
  if (result.error === "invalid_transition") return { outcome: "not_applicable" };
  throw new Error(`EXPIRE of ${order.number} was refused: ${result.error}`);
}

export async function sweepExpiry(deps: TermsDeps): Promise<Record<ExpiryOutcome | "failed", number>> {
  const count: Record<ExpiryOutcome | "failed", number> = { expired: 0, too_early: 0, not_applicable: 0, failed: 0 };
  for (const id of await deps.store.expiryCandidates(deps.now(), SWEEP_LIMIT)) {
    try {
      count[(await expireEstimate(deps, id)).outcome] += 1;
    } catch (error) {
      count.failed += 1;
      deps.log.error({ orderId: id, err: error instanceof Error ? error.message : String(error) }, "EXPIRE failed");
    }
  }
  return count;
}

// ---- the reminder 24 hours after ACCEPT ----------------------------------------------------------------------------------

export type AcceptReminder = { outcome: "reminded"; missing: "fee" | "funds" | "both" } | { outcome: "not_needed" };

/** The job fires a day after ACCEPT and looks at the flags then: a customer who has paid is not bothered. */
export async function remindAccept(deps: TermsDeps, orderId: string): Promise<AcceptReminder> {
  const order = await deps.store.order(orderId);
  if (order === null || order.status !== "accepted") return { outcome: "not_needed" };
  if (order.feePrepaid && order.fundsReceived) return { outcome: "not_needed" };
  const missing = !order.feePrepaid && !order.fundsReceived ? "both" : order.feePrepaid ? "funds" : "fee";
  await deps.enqueue({
    kind: "telegram_message",
    // One reminder per order, ever: a repeated job does not repeat the message.
    dedupeKey: `order:${order.id}:accept_reminder`,
    payload: {
      target: "customer",
      templateKey: "order.accept_reminder",
      customerId: order.customerId,
      orderId: order.id,
      orderNumber: order.number,
      params: { missing },
    },
  });
  return { outcome: "reminded", missing };
}
