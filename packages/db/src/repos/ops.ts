// Repositories of the ops schema: settings, audit log, outbox, consents, files, public numbers, admin accounts,
// errors, threshold snapshots, data subject requests (ARCHITECTURE 3.3).
import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import {
  adminSessions,
  adminUsers,
  appErrors,
  auditLog,
  consents,
  dsrRequests,
  files,
  outbox,
  settings,
  thresholdSnapshots,
} from "../schema/ops.ts";
import { DbRuleError } from "./errors.ts";
import type { Executor } from "./executor.ts";

export type SettingRow = typeof settings.$inferSelect;
export type AuditInput = Omit<typeof auditLog.$inferInsert, "id" | "at"> & { at?: Date };
export type OutboxRow = typeof outbox.$inferSelect;
export type ConsentRow = typeof consents.$inferSelect;
export type FileInsert = Omit<typeof files.$inferInsert, "id" | "createdAt">;
export type AdminUserRow = typeof adminUsers.$inferSelect;

// ---- settings ---------------------------------------------------------------------------------------------------
export async function getSetting<T = unknown>(
  db: Executor,
  key: string,
): Promise<{ value: T; version: number } | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row ? { value: row.value as T, version: row.version } : null;
}

/**
 * Writes a setting and journals the change in ops.audit_log in one transaction. With `expectedVersion` the change is
 * refused (stale_status) when somebody else changed the setting meanwhile; without it the value is simply set.
 */
export async function setSetting(
  db: Executor,
  key: string,
  value: unknown,
  by: string,
  opts: { expectedVersion?: number; ipHash?: string } = {},
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const before = await getSetting(tx, key);
    if (opts.expectedVersion !== undefined && (before?.version ?? 0) !== opts.expectedVersion) {
      throw new DbRuleError(
        "stale_status",
        `stale_status: setting ${key} is at version ${before?.version ?? 0}, expected ${opts.expectedVersion}`,
      );
    }
    let version: number;
    if (before) {
      const [row] = await tx
        .update(settings)
        .set({ value, updatedBy: by })
        .where(eq(settings.key, key))
        .returning({ version: settings.version });
      version = row?.version ?? before.version + 1;
    } else {
      const [row] = await tx
        .insert(settings)
        .values({ key, value, updatedBy: by })
        .returning({ version: settings.version });
      version = row?.version ?? 1;
    }
    await appendAudit(tx, {
      actor: by,
      action: "setting.set",
      entity: "ops.settings",
      entityId: key,
      before: before?.value ?? null,
      after: value,
      ipHash: opts.ipHash ?? null,
    });
    return { version };
  });
}

// ---- audit log --------------------------------------------------------------------------------------------------
export async function appendAudit(db: Executor, input: AuditInput): Promise<string> {
  const [row] = await db.insert(auditLog).values(input).returning({ id: auditLog.id });
  if (!row) throw new Error("audit row was not written");
  return row.id;
}

export async function listAudit(db: Executor, entity: string, entityId: string, limit = 100) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit);
}

// ---- outbox -----------------------------------------------------------------------------------------------------
export interface OutboxInput {
  kind: "telegram_message" | "job";
  payload: Record<string, unknown>;
  /** A second write with the same key is ignored: repeated dispatch does not duplicate effects. */
  dedupeKey?: string;
  priority?: number;
  sendAfter?: Date;
}

export async function enqueueOutbox(db: Executor, input: OutboxInput): Promise<{ id: string; duplicate: boolean }> {
  const [row] = await db
    .insert(outbox)
    .values({
      kind: input.kind,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      priority: input.priority ?? 0,
      ...(input.sendAfter ? { sendAfter: input.sendAfter } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: outbox.id });
  if (row) return { id: row.id, duplicate: false };
  if (!input.dedupeKey) throw new Error("outbox row was not written");
  const [existing] = await db.select({ id: outbox.id }).from(outbox).where(eq(outbox.dedupeKey, input.dedupeKey));
  if (!existing) throw new Error("outbox row vanished");
  return { id: existing.id, duplicate: true };
}

/** The next batch for the relay. Call inside a transaction: rows stay locked (SKIP LOCKED) until it ends. */
export async function claimOutbox(db: Executor, limit: number, now: Date = new Date()): Promise<OutboxRow[]> {
  return db
    .select()
    .from(outbox)
    .where(and(eq(outbox.status, "pending"), lte(outbox.sendAfter, now)))
    .orderBy(desc(outbox.priority), asc(outbox.sendAfter), asc(outbox.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
}

export async function markOutboxSent(db: Executor, id: string, now: Date = new Date()): Promise<void> {
  await db.update(outbox).set({ status: "sent", sentAt: now, lastError: null }).where(eq(outbox.id, id));
}

/** A failed attempt: retried after `retryAfterMs`, `failed` for good after `maxAttempts` attempts. */
export async function markOutboxFailed(
  db: Executor,
  id: string,
  error: string,
  opts: { maxAttempts?: number; retryAfterMs?: number; now?: Date } = {},
): Promise<"pending" | "failed" | "sent"> {
  const now = opts.now ?? new Date();
  const [row] = await db
    .update(outbox)
    .set({
      attempts: sql`${outbox.attempts} + 1`,
      lastError: error,
      status: sql`case when ${outbox.attempts} + 1 >= ${opts.maxAttempts ?? 5} then 'failed' else 'pending' end`,
      sendAfter: sql`${new Date(now.getTime() + (opts.retryAfterMs ?? 60_000)).toISOString()}::timestamptz`,
    })
    .where(eq(outbox.id, id))
    .returning({ status: outbox.status });
  if (!row) throw new Error(`outbox row ${id} not found`);
  return row.status;
}

// ---- consents ---------------------------------------------------------------------------------------------------
export type ConsentInput = Omit<typeof consents.$inferInsert, "id" | "at"> & { at?: Date };

export async function recordConsent(db: Executor, input: ConsentInput): Promise<string> {
  const [row] = await db.insert(consents).values(input).returning({ id: consents.id });
  if (!row) throw new Error("consent was not written");
  return row.id;
}

/** The newest row of the kind for the order: a withdrawal is a newer row with granted = false. */
export async function latestConsent(
  db: Executor,
  orderId: string,
  kind: ConsentRow["kind"],
): Promise<ConsentRow | null> {
  const [row] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.orderId, orderId), eq(consents.kind, kind)))
    .orderBy(desc(consents.at), desc(consents.id))
    .limit(1);
  return row ?? null;
}

export async function consentGranted(db: Executor, orderId: string, kind: ConsentRow["kind"]): Promise<boolean> {
  return (await latestConsent(db, orderId, kind))?.granted === true;
}

// ---- files ------------------------------------------------------------------------------------------------------
export async function registerFile(db: Executor, input: FileInsert): Promise<string> {
  const [row] = await db.insert(files).values(input).returning({ id: files.id });
  if (!row) throw new Error("file was not registered");
  return row.id;
}

export async function getFile(db: Executor, id: string) {
  const [row] = await db.select().from(files).where(eq(files.id, id));
  return row ?? null;
}

// ---- public numbers ---------------------------------------------------------------------------------------------
/** L-2026-0001, NV-2026-0001, G-2026-0001; gap-free inside the caller's transaction. */
export async function nextNumber(db: Executor, kind: "L" | "NV" | "G", year: number): Promise<string> {
  const { rows } = await db.execute<{ n: string }>(sql`select ops.next_number(${kind}, ${year}) as n`);
  const n = rows[0]?.n;
  if (!n) throw new Error("number was not issued");
  return n;
}

// ---- errors and thresholds --------------------------------------------------------------------------------------
export async function recordAppError(
  db: Executor,
  e: { app: string; fingerprint: string; message: string; stack?: string },
): Promise<{ count: number }> {
  const [row] = await db
    .insert(appErrors)
    .values({ app: e.app, fingerprint: e.fingerprint, message: e.message, stack: e.stack ?? null })
    .onConflictDoUpdate({
      target: [appErrors.app, appErrors.fingerprint],
      set: { count: sql`${appErrors.count} + 1`, lastAt: sql`now()` },
    })
    .returning({ count: appErrors.count });
  return { count: row?.count ?? 1 };
}

export type ThresholdSnapshotInput = Omit<typeof thresholdSnapshots.$inferInsert, "id">;

export async function saveThresholdSnapshot(db: Executor, s: ThresholdSnapshotInput): Promise<void> {
  await db
    .insert(thresholdSnapshots)
    .values(s)
    .onConflictDoUpdate({
      target: [thresholdSnapshots.year, thresholdSnapshots.asOf],
      set: {
        dealsSum: s.dealsSum,
        committedSum: s.committedSum,
        limitSum: s.limitSum,
        planCapSum: s.planCapSum ?? null,
        shareBp: s.shareBp,
      },
    });
}

export async function latestThresholdSnapshot(db: Executor, year: number) {
  const [row] = await db
    .select()
    .from(thresholdSnapshots)
    .where(eq(thresholdSnapshots.year, year))
    .orderBy(desc(thresholdSnapshots.asOf))
    .limit(1);
  return row ?? null;
}

// ---- data subject requests --------------------------------------------------------------------------------------
export async function createDsrRequest(db: Executor, customerId: string, kind: "copy" | "rectify" | "erase") {
  const [row] = await db.insert(dsrRequests).values({ customerId, kind }).returning();
  if (!row) throw new Error("request was not written");
  return row;
}

export async function listOpenDsrRequests(db: Executor) {
  return db
    .select()
    .from(dsrRequests)
    .where(inArray(dsrRequests.status, ["open", "in_progress"]))
    .orderBy(asc(dsrRequests.due));
}

// ---- admin accounts and sessions --------------------------------------------------------------------------------
export async function createAdminUser(
  db: Executor,
  u: { email: string; passwordHash: string; role: AdminUserRow["role"]; telegramUserId?: number },
): Promise<string> {
  const [row] = await db
    .insert(adminUsers)
    .values({ email: u.email, passwordHash: u.passwordHash, role: u.role, telegramUserId: u.telegramUserId ?? null })
    .returning({ id: adminUsers.id });
  if (!row) throw new Error("admin user was not written");
  return row.id;
}

export async function findAdminByEmail(db: Executor, email: string): Promise<AdminUserRow | null> {
  const [row] = await db.select().from(adminUsers).where(sql`lower(${adminUsers.email}) = lower(${email})`);
  return row ?? null;
}

/** Counts a failed login and locks the account after `lockAfter` failures; returns the new state. */
export async function recordFailedLogin(
  db: Executor,
  id: string,
  opts: { lockAfter: number; lockMinutes: number; now?: Date },
): Promise<{ failedLogins: number; lockedUntil: Date | null }> {
  const now = opts.now ?? new Date();
  const lockUntil = new Date(now.getTime() + opts.lockMinutes * 60_000).toISOString();
  const [row] = await db
    .update(adminUsers)
    .set({
      failedLogins: sql`${adminUsers.failedLogins} + 1`,
      lockedUntil: sql`case when ${adminUsers.failedLogins} + 1 >= ${opts.lockAfter} then ${lockUntil}::timestamptz else ${adminUsers.lockedUntil} end`,
    })
    .where(eq(adminUsers.id, id))
    .returning({ failedLogins: adminUsers.failedLogins, lockedUntil: adminUsers.lockedUntil });
  if (!row) throw new Error(`admin user ${id} not found`);
  return row;
}

export async function resetFailedLogins(db: Executor, id: string): Promise<void> {
  await db.update(adminUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(adminUsers.id, id));
}

export async function createAdminSession(
  db: Executor,
  s: { tokenSha256: string; userId: string; expiresAt: Date; ipHash?: string; ua?: string },
): Promise<void> {
  await db.insert(adminSessions).values({ ...s, ipHash: s.ipHash ?? null, ua: s.ua ?? null });
}

/** The session while it has not expired; moves last_seen_at forward. */
export async function touchAdminSession(db: Executor, tokenSha256: string, now: Date = new Date()) {
  const [row] = await db
    .update(adminSessions)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(adminSessions.tokenSha256, tokenSha256),
        sql`${adminSessions.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteAdminSession(db: Executor, tokenSha256: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.tokenSha256, tokenSha256));
}

export async function deleteExpiredAdminSessions(db: Executor, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, now))
    .returning({ t: adminSessions.tokenSha256 });
  return rows.length;
}
