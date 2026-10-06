// ops.settings on PostgreSQL through the repository of WP-06: the version is bumped by a trigger, the change and its
// audit row are written in one transaction (`setSetting`), a stale writer loses (`stale_status`).
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import type { RevalidateRetry, SettingsStore } from "./service.ts";

export function createPgSettingsStore(db: Db): SettingsStore {
  return {
    get: (key) => ops.getSetting(db, key),

    set: (key, value, by, opts = {}) =>
      ops.setSetting(db, key, value, by, {
        ...(opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
        ...(opts.ipHash ? { ipHash: opts.ipHash } : {}),
      }),

    async setMany(changes, by) {
      await db.transaction(async (tx) => {
        for (const change of changes) await ops.setSetting(tx, change.key, change.value, by);
      });
    },
  };
}

/**
 * A request to the site that did not get through is left for the worker: a `job` row in ops.outbox, one per tag set and
 * minute, so that repeated saves do not pile up identical jobs.
 */
export function createPgRevalidateRetry(db: Db, now: () => Date = () => new Date()): RevalidateRetry {
  return {
    async enqueueRevalidate(tags) {
      const minute = Math.floor(now().getTime() / 60_000);
      await ops.enqueueOutbox(db, {
        kind: "job",
        payload: { job: "web.revalidate", tags },
        dedupeKey: `web.revalidate:${[...tags].sort().join("+")}:${minute}`,
      });
    },
  };
}
