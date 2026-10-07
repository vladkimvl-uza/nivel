import { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import type { JobContext } from "../types.ts";
import { handleVendorExpiry, handleWarrantySla, type WarrantyDeps } from "./sla.ts";
import { createPgWarrantyReaders } from "./store.ts";

export const WARRANTY_QUEUE = { sla: "warranty.sla", vendorExpiry: "warranty.vendor_expiry" } as const;

export function warrantyDepsOf(rt: WorkerRuntime): WarrantyDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    ...createPgWarrantyReaders(rt.db),
    enqueue: (input) => ops.enqueueOutbox(rt.db, input),
  };
}

/** Domain "warranty" (ARCHITECTURE 9): warranty.sla every 15 minutes, warranty.vendor_expiry at 09:00. Owner — WP-14. */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const deps = warrantyDepsOf(ctx.runtime);
  await registerQueue(ctx, {
    name: WARRANTY_QUEUE.sla,
    cron: "*/15 * * * *",
    handler: async () => {
      await handleWarrantySla(deps);
    },
  });
  await registerQueue(ctx, {
    name: WARRANTY_QUEUE.vendorExpiry,
    cron: "0 9 * * *",
    handler: async () => {
      await handleVendorExpiry(deps, isoDateInTashkent(deps.now()));
    },
  });
}
