import { ops } from "@nivel/db/repos";
import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import type { JobContext } from "../types.ts";
import { createPgErrorReader, type DigestDeps, handleErrorDigest } from "./digest.ts";
import { createPgPromotePorts, type PromoteDeps, promoteDueFeeScale } from "./promote.ts";
import { runSelfcheck, type SelfcheckDeps } from "./selfcheck.ts";

export const OPS_QUEUE = {
  selfcheck: "ops.selfcheck",
  errorDigest: "ops.error_digest",
  feeScalePromote: "ops.fee_scale.promote",
} as const;

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

export function promoteDepsOf(rt: WorkerRuntime): PromoteDeps {
  return { now: () => rt.now(), log: rt.log, ...createPgPromotePorts(rt.db), enqueue: enqueueOf(rt) };
}

/**
 * Domain "ops" (ARCHITECTURE 9): ops.selfcheck every 10 minutes, ops.error_digest at 20:00, and the daily entry into force of the
 * scheduled scale of the fee (00:05). Owner — WP-14.
 */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const rt = ctx.runtime;
  const selfcheck = selfcheckDepsOf(rt);
  const digest = digestDepsOf(rt);
  const promote = promoteDepsOf(rt);

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
}
