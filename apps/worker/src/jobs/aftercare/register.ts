import { ops } from "@nivel/db/repos";
import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import type { JobContext } from "../types.ts";
import { createPgMaintenanceReader, handleMaintenance, type MaintenanceDeps } from "./maintenance.ts";

export const AFTERCARE_QUEUE = "aftercare";

export function maintenanceDepsOf(rt: WorkerRuntime): MaintenanceDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    candidates: createPgMaintenanceReader(rt.db),
    enqueue: (input) => ops.enqueueOutbox(rt.db, input),
  };
}

/**
 * Domain "aftercare" (ARCHITECTURE 9): at 10:00 the preventive maintenance of the PCs handed over 6 and 12 months ago. The calls after 7
 * and 30 days are jobs of the order calendar (orders.scheduled), the credit of "Podbor" is read from the order (ADR-007). Owner — WP-14.
 */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const deps = maintenanceDepsOf(ctx.runtime);
  await registerQueue(ctx, {
    name: AFTERCARE_QUEUE,
    cron: "0 10 * * *",
    handler: async () => {
      await handleMaintenance(deps);
    },
  });
}
