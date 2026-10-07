import { payments } from "@nivel/services";
import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import { isFlagOn } from "../../queues/settings.ts";
import type { JobContext } from "../types.ts";
import { createPgDirectory } from "./directory.ts";
import { createPgLedgerPort, handleLedgerAppend } from "./ledger-append.ts";
import { startPolling } from "./loop.ts";
import { handlePaymentExpect } from "./payment-expect.ts";
import { type RelayDeps, relayOnce } from "./relay.ts";
import { handleRevalidate } from "./revalidate.ts";
import { QUEUE } from "./routes.ts";
import { createPgOutboxStore } from "./store.ts";

const POLL_MS = 5000;
const BATCH = 10;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function relayDepsOf(rt: WorkerRuntime): RelayDeps {
  return {
    now: () => rt.now(),
    sleep,
    log: rt.log,
    store: createPgOutboxStore(rt.db),
    directory: createPgDirectory(rt.db),
    flags: { isOn: (key) => isFlagOn(rt.db, key) },
    telegram: rt.telegram,
    throttle: rt.throttle,
    renderer: rt.renderer,
    jobs: rt.jobs,
    failures: rt.failures,
  };
}

/** Domain "outbox" (ARCHITECTURE 9): outbox.relay and the queues it feeds: payment.expect, ledger.append, web.revalidate. Owner — WP-14. */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const rt = ctx.runtime;
  const relay = relayDepsOf(rt);

  // The relay is a poll every 5 s (the loop below) and a job every minute: if the loop were ever to stop, the minute job takes
  // the rows. Both take rows with FOR UPDATE SKIP LOCKED, so they never take the same one.
  await registerQueue(ctx, {
    name: QUEUE.relay,
    cron: "* * * * *",
    handler: async () => {
      await relayOnce(relay, { limit: BATCH });
    },
  });
  ctx.onStart(() => {
    const polling = startPolling({
      pass: () => relayOnce(relay, { limit: BATCH }),
      intervalMs: POLL_MS,
      fullBatch: BATCH,
      onError: (error) =>
        rt.log.error({ err: error instanceof Error ? error.message : String(error) }, "outbox.relay: a pass failed"),
    });
    ctx.onStop(() => polling.stop());
  });

  await registerQueue(ctx, {
    name: QUEUE.paymentExpect,
    handler: async (data) => {
      await handlePaymentExpect(
        { log: rt.log, expectFromJob: (input) => payments.expectFromJob(input, rt.services) },
        data,
      );
    },
  });

  const ledgerPort = createPgLedgerPort(rt.db);
  await registerQueue(ctx, {
    name: QUEUE.ledgerAppend,
    handler: async (data) => {
      await handleLedgerAppend({ log: rt.log, port: ledgerPort }, data);
    },
  });

  await registerQueue(ctx, {
    name: QUEUE.webRevalidate,
    // The site may be restarting: six retries over about half an hour (30 s, 1, 2, 4, 8, 10 min).
    retry: { limit: 6, delaySec: 30, backoff: true, maxDelaySec: 600 },
    handler: async (data) => {
      await handleRevalidate({ fetch: rt.fetch, now: () => rt.now(), log: rt.log, settings: rt.settings }, data);
    },
  });
}
