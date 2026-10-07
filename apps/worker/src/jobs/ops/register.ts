import { ops } from "@nivel/db/repos";
import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import type { JobContext } from "../types.ts";
import { createPgCandidates } from "./crm/candidates.ts";
import {
  loadLeadFacts,
  loadOrderChangeFacts,
  loadPaymentFacts,
  loadPurchaseFacts,
  loadWarrantyFacts,
} from "./crm/facts.ts";
import { type CollectDeps, type CrmDeps, collectCrmEvents, createRateLimiter, handleCrmSync } from "./crm/sync.ts";
import { createPgErrorReader, type DigestDeps, handleErrorDigest } from "./digest.ts";
import { createPgPromotePorts, type PromoteDeps, promoteDueFeeScale } from "./promote.ts";
import { runSelfcheck, type SelfcheckDeps } from "./selfcheck.ts";

export const OPS_QUEUE = {
  selfcheck: "ops.selfcheck",
  errorDigest: "ops.error_digest",
  feeScalePromote: "ops.fee_scale.promote",
  crmCollect: "crm.collect",
  crmSync: "crm.sync",
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const enqueueOf = (rt: WorkerRuntime) => (input: ops.OutboxInput) => ops.enqueueOutbox(rt.db, input);

export function selfcheckDepsOf(rt: WorkerRuntime): SelfcheckDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    probes: rt.probes,
    stalledQueues: (seconds) => rt.jobs.stalled(seconds),
    async outboxStalledSeconds() {
      const { rows } = await rt.db.$client.query<{ s: number | null }>(
        `select extract(epoch from clock_timestamp() - min(send_after))::float8 as s
           from ops.outbox where status = 'pending' and send_after <= clock_timestamp()`,
      );
      return rows[0]?.s ?? null;
    },
    webhook:
      rt.settings.botMode === "webhook" && rt.telegram.enabled
        ? async () => {
            const info = await rt.telegram.getWebhookInfo();
            return { lastErrorDate: info.lastErrorDate, lastErrorMessage: info.lastErrorMessage };
          }
        : null,
    enqueue: enqueueOf(rt),
  };
}

export function digestDepsOf(rt: WorkerRuntime): DigestDeps {
  return { now: () => rt.now(), log: rt.log, recentErrors: createPgErrorReader(rt.db), enqueue: enqueueOf(rt) };
}

export function crmCollectDepsOf(rt: WorkerRuntime): CollectDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    config: rt.settings.crm ?? null,
    candidates: createPgCandidates(rt.db),
    enqueue: enqueueOf(rt),
  };
}

export function crmDepsOf(rt: WorkerRuntime): CrmDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    config: rt.settings.crm ?? null,
    env: rt.settings.appMode,
    fetch: rt.fetch,
    // The contract of the CRM: no more than one event a second.
    limiter: createRateLimiter({ now: () => rt.now().getTime(), sleep, gapMs: 1000 }),
    facts: {
      lead: (id) => loadLeadFacts(rt.db, id),
      order: (id, seq) => loadOrderChangeFacts(rt.db, id, seq),
      payment: (id) => loadPaymentFacts(rt.db, id),
      purchase: (id) => loadPurchaseFacts(rt.db, id),
      warranty: (id) => loadWarrantyFacts(rt.db, id),
    },
  };
}

export function promoteDepsOf(rt: WorkerRuntime): PromoteDeps {
  return { now: () => rt.now(), log: rt.log, ...createPgPromotePorts(rt.db), enqueue: enqueueOf(rt) };
}

/**
 * Domain "ops" (ARCHITECTURE 9): ops.selfcheck every 10 minutes, ops.error_digest at 20:00, the daily entry into force of the
 * scheduled scale of the fee (00:05), and the feed of the CRM in Google Sheets (crm.collect, crm.sync). Owner — WP-14.
 */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const rt = ctx.runtime;
  const selfcheck = selfcheckDepsOf(rt);
  const digest = digestDepsOf(rt);
  const promote = promoteDepsOf(rt);
  const crmCollect = crmCollectDepsOf(rt);
  const crm = crmDepsOf(rt);

  await registerQueue(ctx, {
    name: OPS_QUEUE.selfcheck,
    cron: "*/10 * * * *",
    handler: async () => {
      await runSelfcheck(selfcheck);
    },
  });
  await registerQueue(ctx, {
    name: OPS_QUEUE.errorDigest,
    cron: "0 20 * * *",
    handler: async () => {
      await handleErrorDigest(digest);
    },
  });
  await registerQueue(ctx, {
    name: OPS_QUEUE.feeScalePromote,
    cron: "5 0 * * *",
    handler: async () => {
      await promoteDueFeeScale(promote);
    },
  });

  // The CRM of the owner in Google Sheets: what is new is queued every minute, and each event is sent on its own, one a second.
  await registerQueue(ctx, {
    name: OPS_QUEUE.crmCollect,
    cron: "* * * * *",
    handler: async () => {
      await collectCrmEvents(crmCollect);
    },
  });
  await registerQueue(ctx, {
    name: OPS_QUEUE.crmSync,
    // The book may be busy or Google may be slow: seven attempts over about an hour (30 s, 1, 2, 4, 8, 16, 30 min).
    retry: { limit: 6, delaySec: 30, backoff: true, maxDelaySec: 1800 },
    concurrency: 1,
    handler: async (data, meta) => {
      await handleCrmSync(crm, data, meta.id);
    },
  });
}
