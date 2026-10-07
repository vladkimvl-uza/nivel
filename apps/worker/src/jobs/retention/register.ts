import { registerQueue } from "../../queues/define.ts";
import { type WorkerRuntime, workerContext } from "../../queues/runtime.ts";
import type { JobContext } from "../types.ts";
import { createPgRetentionPorts, handleRetention, type RetentionDeps } from "./purge.ts";

export const RETENTION_QUEUE = "retention.purge";

export function retentionDepsOf(rt: WorkerRuntime): RetentionDeps {
  return {
    now: () => rt.now(),
    log: rt.log,
    ports: createPgRetentionPorts(rt.db),
    removeBytes: (key) => rt.files.remove(key),
    filesEnabled: rt.settings.filesDir !== undefined,
  };
}

/**
 * Domain "retention" (ARCHITECTURE 9): retention.purge at 03:30 Tashkent. Requests without an order after 12 months, files by their
 * class (the bytes are removed before the commit), the dialogues of the AI after 90 days, the updates of Telegram after 7 days,
 * the idle sessions of the bot. Owner — WP-14.
 */
export async function register(raw: JobContext): Promise<void> {
  const ctx = workerContext(raw);
  const deps = retentionDepsOf(ctx.runtime);
  await registerQueue(ctx, {
    name: RETENTION_QUEUE,
    cron: "30 3 * * *",
    handler: async () => {
      await handleRetention(deps);
    },
  });
}
