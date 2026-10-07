// ops.error_digest (ARCHITECTURE 9): at 20:00 one message to the owner's group with the failures of the day from ops.app_errors (the
// ones that were written after the last attempt of a job). A quiet day sends nothing.
import type { Db } from "@nivel/db";
import type { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import type { Logger } from "pino";

const SHOWN = 10;
const DAY_MS = 86_400_000;

export interface ErrorRow {
  /** The application that wrote the row: the worker, the site, the admin panel or the bot. */
  app: string;
  message: string;
  count: number;
  lastAt: Date;
}

export interface DigestDeps {
  now(): Date;
  log: Logger;
  recentErrors(since: Date): Promise<ErrorRow[]>;
  enqueue(input: ops.OutboxInput): Promise<unknown>;
}

export async function handleErrorDigest(deps: DigestDeps): Promise<{ sent: boolean; items: number }> {
  const now = deps.now();
  const rows = await deps.recentErrors(new Date(now.getTime() - DAY_MS));
  if (rows.length === 0) return { sent: false, items: 0 };
  const items = rows.slice(0, SHOWN).map((r) => {
    // The worker writes "[queue] text" (queues/failures.ts); the other applications write their own text.
    const m = r.app === "worker" ? /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(r.message) : null;
    return { queue: m?.[1] ?? (r.app === "worker" ? "-" : r.app), message: m?.[2] ?? r.message, count: r.count };
  });
  await deps.enqueue({
    kind: "telegram_message",
    dedupeKey: `ops:digest:${isoDateInTashkent(now)}`,
    payload: {
      target: "group",
      templateKey: "ops.digest",
      lang: "ru",
      params: { items, more: Math.max(0, rows.length - SHOWN) },
    },
  });
  deps.log.info({ items: rows.length }, "ops.error_digest");
  return { sent: true, items: rows.length };
}

export function createPgErrorReader(db: Db): DigestDeps["recentErrors"] {
  return async (since) => {
    const { rows } = await db.$client.query<{ app: string; message: string; count: number; last_at: Date }>(
      "select app, message, count, last_at from ops.app_errors where last_at >= $1 order by last_at desc limit 100",
      [since],
    );
    return rows.map((r) => ({ app: r.app, message: r.message, count: r.count, lastAt: r.last_at }));
  };
}
