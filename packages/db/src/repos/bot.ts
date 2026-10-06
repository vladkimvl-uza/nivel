// Repositories of the bot schema: sessions, processed updates, subscriptions (ARCHITECTURE 3.3, 7.1).
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { processedUpdates, sessions, subscriptions } from "../schema/bot.ts";
import { guarded } from "./errors.ts";
import type { Executor } from "./executor.ts";

export async function getSession(db: Executor, key: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select({ value: sessions.value }).from(sessions).where(eq(sessions.key, key));
  return row?.value ?? null;
}

export async function saveSession(db: Executor, key: string, value: Record<string, unknown>): Promise<void> {
  await db
    .insert(sessions)
    .values({ key, value })
    .onConflictDoUpdate({ target: sessions.key, set: { value, updatedAt: sql`now()` } });
}

export async function deleteSession(db: Executor, key: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.key, key));
}

/** True the first time an update id is seen, false for a repeat (Telegram retries a webhook that answered late). */
export async function markUpdateProcessed(db: Executor, updateId: number): Promise<boolean> {
  const rows = await db
    .insert(processedUpdates)
    .values({ updateId })
    .onConflictDoNothing()
    .returning({ id: processedUpdates.updateId });
  return rows.length === 1;
}

/** Forgets updates older than `days` (7 by default). */
export async function purgeProcessedUpdates(db: Executor, days = 7, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(processedUpdates)
    .where(lt(processedUpdates.at, new Date(now.getTime() - days * 86_400_000)))
    .returning({ id: processedUpdates.updateId });
  return rows.length;
}

/** Subscribes (again) to a topic; the consent row proves the permission and is kept when none is given again. */
export async function subscribe(
  db: Executor,
  telegramUserId: number,
  topic: string,
  consentId?: string,
): Promise<void> {
  await guarded(() =>
    db
      .insert(subscriptions)
      .values({ telegramUserId, topic, consentId: consentId ?? null })
      .onConflictDoUpdate({
        target: [subscriptions.telegramUserId, subscriptions.topic],
        set: {
          unsubscribedAt: null,
          consentId: sql`coalesce(${consentId ?? null}::uuid, ${subscriptions.consentId})`,
        },
      }),
  );
}

export async function unsubscribe(
  db: Executor,
  telegramUserId: number,
  topic: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ unsubscribedAt: at })
    .where(and(eq(subscriptions.telegramUserId, telegramUserId), eq(subscriptions.topic, topic)));
}

export async function listSubscribers(db: Executor, topic: string): Promise<number[]> {
  const rows = await db
    .select({ id: subscriptions.telegramUserId })
    .from(subscriptions)
    .where(and(eq(subscriptions.topic, topic), isNull(subscriptions.unsubscribedAt)));
  return rows.map((r) => r.id);
}
