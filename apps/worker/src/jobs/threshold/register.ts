import { ops } from "@nivel/db/repos";
import { threshold } from "@nivel/services";
import { PermanentJobError, registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import { QUEUE } from "../outbox/routes.ts";
import type { JobContext } from "../types.ts";
import { handleThresholdCheck, readPlanCap, type ThresholdDeps } from "./check.ts";

export function thresholdDepsOf(rt: WorkerRuntime): ThresholdDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    status: async (year) => {
      try {
        return await threshold.status({ year }, rt.services);
      } catch (error) {
        // A broken setting of the owner (the threshold) is not mended by a retry.
        if (error instanceof Error && error.name === "ConfigError") throw new PermanentJobError(error.message);
        throw error;
      }
    },
    planCap: () => readPlanCap(rt.db),
    saveSnapshot: (snapshot) => ops.saveThresholdSnapshot(rt.db, snapshot),
    enqueue: (input) => ops.enqueueOutbox(rt.db, input),
  };
}

/** Domain "threshold" (ARCHITECTURE 9): threshold.check at 06:00 and after a payment or a receipt (the outbox sends it here). Owner — WP-14. */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const deps = thresholdDepsOf(ctx.runtime);
  await registerQueue(ctx, {
    name: QUEUE.thresholdCheck,
    cron: "0 6 * * *",
    handler: async () => {
      await handleThresholdCheck(deps);
    },
  });
}
