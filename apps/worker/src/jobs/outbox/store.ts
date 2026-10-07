// The door of the relay to ops.outbox. The relay does not hold a transaction while it talks to Telegram: it takes a lease on
// the rows in one statement (the rows stay `pending`, their `send_after` moves a few minutes ahead), works on them, and then
// marks each row. A worker that dies in between leaves rows whose lease runs out, and the next pass takes them again; the
// handlers are idempotent (DATA-MAP 3: the dedupe key makes a repeated row a no-op). Every moment is the clock of the
// database, the one `send_after` is stamped with.
import type { Db } from "@nivel/db";

/** How long a claimed row is the relay's before another pass may take it. */
export const LEASE_SECONDS = 300;

export interface OutboxRow {
  id: string;
  kind: "telegram_message" | "job";
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  priority: number;
  /** Attempts that failed before this one. */
  attempts: number;
  createdAt: Date;
}

export interface OutboxStore {
  /** Takes the rows that are due (highest priority first) and leases them. */
  claim(limit: number): Promise<OutboxRow[]>;
  markSent(id: string): Promise<void>;
  /** An attempt failed: the row is tried again after `retryAfterMs`, or `failed` for good after `maxAttempts`. */
  retryLater(id: string, error: string, retryAfterMs: number, maxAttempts: number): Promise<"pending" | "failed">;
  /** The row cannot succeed: `failed` at once. */
  fail(id: string, error: string): Promise<void>;
  /** The row is not sent on purpose (no token, no address): `failed` with the reason, no attempt counted. */
  skip(id: string, reason: string): Promise<void>;
  /** Not yet (throttled, waits for a flag): back to `pending` for `ms`, no attempt counted. */
  defer(id: string, ms: number): Promise<void>;
}

interface ClaimedRow {
  id: string;
  kind: "telegram_message" | "job";
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  priority: number;
  attempts: number;
  created_at: Date;
}

export function createPgOutboxStore(db: Db): OutboxStore {
  const q = db.$client;
  return {
    async claim(limit) {
      const { rows } = await q.query<ClaimedRow>(
        `with due as (
           select id from ops.outbox
            where status = 'pending' and send_after <= clock_timestamp()
            order by priority desc, send_after, created_at
            limit $1
              for update skip locked)
         update ops.outbox o
            set send_after = clock_timestamp() + make_interval(secs => $2::float8)
           from due
          where o.id = due.id
      returning o.id, o.kind, o.payload, o.dedupe_key, o.priority, o.attempts, o.created_at`,
        [limit, LEASE_SECONDS],
      );
      return rows
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          payload: r.payload,
          dedupeKey: r.dedupe_key,
          priority: r.priority,
          attempts: r.attempts,
          createdAt: r.created_at,
        }))
        .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());
    },

    async markSent(id) {
      await q.query(
        "update ops.outbox set status = 'sent', sent_at = clock_timestamp(), last_error = null where id = $1",
        [id],
      );
    },

    async retryLater(id, error, retryAfterMs, maxAttempts) {
      const { rows } = await q.query<{ status: "pending" | "failed" }>(
        `update ops.outbox
            set attempts = attempts + 1,
                last_error = $2,
                status = case when attempts + 1 >= $4 then 'failed' else 'pending' end,
                send_after = clock_timestamp() + make_interval(secs => $3::float8)
          where id = $1
      returning status`,
        [id, error, retryAfterMs / 1000, maxAttempts],
      );
      const row = rows[0];
      if (!row) throw new Error(`outbox row ${id} not found`);
      return row.status;
    },

    async fail(id, error) {
      await q.query("update ops.outbox set status = 'failed', attempts = attempts + 1, last_error = $2 where id = $1", [
        id,
        error,
      ]);
    },

    async skip(id, reason) {
      await q.query("update ops.outbox set status = 'failed', last_error = $2 where id = $1", [
        id,
        `skipped: ${reason}`,
      ]);
    },

    async defer(id, ms) {
      await q.query(
        "update ops.outbox set send_after = clock_timestamp() + make_interval(secs => $2::float8) where id = $1",
        [id, ms / 1000],
      );
    },
  };
}
