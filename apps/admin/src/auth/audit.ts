// Every server action writes ops.audit_log (ARCHITECTURE 6.1). `withAudit` wraps an action: the entry is written after
// the action succeeded, a refusal by role is journaled as a denied attempt, and nothing secret is ever put in an entry.
import type { Executor } from "@nivel/db/repos";
import { ops } from "@nivel/db/repos";
import { ForbiddenError } from "./roles.ts";
import type { AuditEntry } from "./store.ts";

export interface AuditSink {
  /** `tx`: the transaction of the change being journaled, when the caller has one. */
  append(entry: AuditEntry, tx?: unknown): Promise<void>;
}

/** The journal on PostgreSQL: the executor of the caller (a transaction) wins over the pool. */
export function createPgAuditSink(db: Executor): AuditSink {
  return {
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
 * Runs `fn` and journals it. The journal write is part of the action: when it fails, the action reports failure too
 * (no change goes unrecorded). A `ForbiddenError` is journaled as `<action>.denied` and thrown again.
 */
export async function withAudit<T>(sink: AuditSink, meta: AuditMeta, fn: () => Promise<Audited<T>>): Promise<T> {
  let result: Audited<T>;
  try {
    result = await fn();
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
  await sink.append({
    actor: meta.actor,
    action: meta.action,
    entity: meta.entity,
    entityId: result.entityId ?? meta.entityId ?? null,
    ...(result.before !== undefined ? { before: result.before } : {}),
    ...(result.after !== undefined ? { after: result.after } : {}),
    ipHash: meta.ipHash ?? null,
  });
  return result.value;
}
