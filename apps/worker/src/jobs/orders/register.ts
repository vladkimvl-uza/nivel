import { ops } from "@nivel/db/repos";
import { orders } from "@nivel/services";
import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import { loadCalendar } from "../../queues/settings.ts";
import { QUEUE } from "../outbox/routes.ts";
import type { JobContext } from "../types.ts";
import { createPgEsfReader, handleEsfReminders } from "./esf.ts";
import { sweepLeadReminders } from "./reminders.ts";
import { handleScheduled, type ScheduledDeps } from "./scheduled.ts";
import { createPgOrdersStore } from "./store.ts";
import { failIfSweepFailed, sweepDeemed, sweepExpiry } from "./terms.ts";

export const ORDERS_QUEUE = {
  estimateExpiry: "orders.estimate.expiry",
  reminders: "orders.reminders",
} as const;

const SYSTEM = { kind: "system", id: "system" } as const;

export function scheduledDepsOf(rt: WorkerRuntime): ScheduledDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    store: createPgOrdersStore(rt.db),
    // The only door by which the worker changes the status of an order: as the system, with the events of the system.
    dispatch: (orderId, event) => orders.dispatch(orderId, event, SYSTEM, rt.services),
    enqueue: (input) => ops.enqueueOutbox(rt.db, input),
    jobs: rt.jobs,
    calendar: () => loadCalendar(rt.db),
  };
}

/**
 * Domain "orders" (ARCHITECTURE 9): orders.estimate.expiry and orders.reminders (the report accepted by the term, requests without an
 * answer, the ESF of purchases) every five minutes, and orders.scheduled, the queue
 * the outbox sends the jobs of the order calendar to. Owner — WP-14.
 */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const deps = scheduledDepsOf(ctx.runtime);
  const esf = {
    now: deps.now,
    log: deps.log,
    esfDue: createPgEsfReader(ctx.runtime.db),
    enqueue: (input: ops.OutboxInput) => ops.enqueueOutbox(ctx.runtime.db, input),
  };

  await registerQueue(ctx, {
    name: QUEUE.ordersScheduled,
    handler: (data) => handleScheduled(deps, data),
  });

  await registerQueue(ctx, {
    name: ORDERS_QUEUE.estimateExpiry,
    cron: "*/5 * * * *",
    handler: async () => {
      const done = await sweepExpiry(deps);
      if (done.expired + done.failed > 0) ctx.runtime.log.info(done, "orders.estimate.expiry");
      failIfSweepFailed("orders.estimate.expiry", done);
    },
  });

  await registerQueue(ctx, {
    name: ORDERS_QUEUE.reminders,
    cron: "*/5 * * * *",
    handler: async () => {
      // The sweeps are independent: a failure of one must not hide the others, and it is still a failure of the job.
      const results = await Promise.allSettled([
        sweepDeemed(deps).then((done) => failIfSweepFailed("orders.reminders", done)),
        sweepLeadReminders(deps),
        handleEsfReminders(esf),
      ]);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed.length > 0) throw failed[0]?.reason;
    },
  });
}
