// Every server action writes ops.audit_log (ARCHITECTURE 6.1). `withAudit` wraps an action: the entry is written after
// the action succeeded, a refusal by role is journaled as a denied attempt, and nothing secret is ever put in an entry.
import type { Database, Executor } from "@nivel/db/repos";
import { ops } from "@nivel/db/repos";
import { ForbiddenError } from "./roles.ts";
import type { AuditEntry } from "./store.ts";

export interface AuditSink {
  /** `tx`: the transaction of the change being journaled, when the caller has one. */
  append(entry: AuditEntry, tx?: unknown): Promise<void>;
  /**
   * Runs `fn` in a transaction and hands it over (what the repositories take as their executor). The change and its
   * journal entry then commit together or not at all. A sink without transactions (tests) leaves it out.
   */
  atomically?<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** The journal on PostgreSQL: the executor of the caller (a transaction) wins over the pool. */
export function createPgAuditSink(db: Database): AuditSink {
  return {
    atomically: (fn) => db.transaction((tx) => fn(tx)),
    async append(entry, tx) {
      await ops.appendAudit((tx as Executor | undefined) ?? db, {
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ipHash: entry.ipHash ?? null,
      });
    },
  };
}

export interface AuditMeta {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  ipHash?: string | null;
}

export interface Audited<T> {
  value: T;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Runs `fn` and journals it. With a sink that has transactions, `fn` gets the transaction and the entry is written
 * through it: the change and its entry commit together, and a journal that cannot be written takes the change back
 * (no change goes unrecorded). A `ForbiddenError` is journaled as `<action>.denied` (outside the transaction, which
 * has been rolled back) and thrown again. A sink without transactions writes the entry after `fn`; the caller then
 * knows that the two are not one unit.
 */
export async function withAudit<T>(
  sink: AuditSink,
  meta: AuditMeta,
  fn: (tx?: unknown) => Promise<Audited<T>>,
): Promise<T> {
  const entryOf = (result: Audited<T>): AuditEntry => ({
    actor: meta.actor,
    action: meta.action,
    entity: meta.entity,
    entityId: result.entityId ?? meta.entityId ?? null,
    ...(result.before !== undefined ? { before: result.before } : {}),
    ...(result.after !== undefined ? { after: result.after } : {}),
    ipHash: meta.ipHash ?? null,
  });
  try {
    if (sink.atomically) {
      return await sink.atomically(async (tx) => {
        const result = await fn(tx);
        await sink.append(entryOf(result), tx);
        return result.value;
      });
    }
    const result = await fn();
    await sink.append(entryOf(result));
    return result.value;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      await sink.append({
        actor: meta.actor,
        action: `${meta.action}.denied`,
        entity: meta.entity,
        entityId: meta.entityId ?? null,
        after: { role: error.role, needed: error.needed },
        ipHash: meta.ipHash ?? null,
      });
    }
    throw error;
  }
}
