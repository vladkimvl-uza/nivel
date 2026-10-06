// Repositories of the ai schema: conversations, the append-only message journal, daily counters (ARCHITECTURE 3.3, 8).
import { asc, eq, sql } from "drizzle-orm";
import { conversations, messages, usageDaily } from "../schema/ai.ts";
import { guarded } from "./errors.ts";
import type { Executor } from "./executor.ts";

export type ConversationInsert = Omit<
  typeof conversations.$inferInsert,
  "id" | "startedAt" | "purgeAfter" | "costMicroUsd" | "filterHits"
>;
export type MessageInsert = Omit<typeof messages.$inferInsert, "conversationId" | "seq">;

export async function startConversation(db: Executor, c: ConversationInsert): Promise<string> {
  const [row] = await guarded(() => db.insert(conversations).values(c).returning({ id: conversations.id }));
  if (!row) throw new Error("conversation was not written");
  return row.id;
}

/** Appends the next message (seq = last + 1 in one statement); two writers at once make one of them fail on the key. */
export async function appendMessage(db: Executor, conversationId: string, m: MessageInsert): Promise<number> {
  const { rows } = await guarded(() =>
    db.execute<{ seq: number }>(sql`
      insert into ai.messages (conversation_id, seq, role, content, shown_text, display_substitution, request_id, usage,
                               latency_ms, stop_reason, tool_calls, guard_events)
      select ${conversationId}::uuid, coalesce(max(seq), 0) + 1, ${m.role}, ${JSON.stringify(m.content)}::jsonb,
             ${m.shownText ?? null}, ${m.displaySubstitution === undefined ? null : JSON.stringify(m.displaySubstitution)}::jsonb,
             ${m.requestId ?? null}, ${m.usage ? JSON.stringify(m.usage) : null}::jsonb, ${m.latencyMs ?? null},
             ${m.stopReason ?? null}, ${m.toolCalls ? JSON.stringify(m.toolCalls) : null}::jsonb,
             ${m.guardEvents ? JSON.stringify(m.guardEvents) : null}::jsonb
        from ai.messages where conversation_id = ${conversationId}::uuid
      returning seq`),
  );
  const seq = rows[0]?.seq;
  if (seq === undefined) throw new Error("message was not written");
  return seq;
}

export async function listMessages(db: Executor, conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.seq));
}

/** Adds the cost and the filter hits of one exchange to the conversation. */
export async function addConversationUsage(
  db: Executor,
  id: string,
  u: { costMicroUsd: number; filterHits?: number; outcome?: (typeof conversations.$inferSelect)["outcome"] },
): Promise<void> {
  await guarded(() =>
    db
      .update(conversations)
      .set({
        costMicroUsd: sql`${conversations.costMicroUsd} + ${u.costMicroUsd}`,
        filterHits: sql`${conversations.filterHits} + ${u.filterHits ?? 0}`,
        ...(u.outcome ? { outcome: u.outcome } : {}),
      })
      .where(eq(conversations.id, id)),
  );
}

/** Adds to the counters of a day and a model (kept for 12 months). */
export async function addDailyUsage(
  db: Executor,
  u: { day: string; model: string; costMicroUsd: number; conversations?: number; tokens?: Record<string, number> },
): Promise<void> {
  await guarded(() =>
    db
      .insert(usageDaily)
      .values({
        day: u.day,
        model: u.model,
        costMicroUsd: u.costMicroUsd,
        conversations: u.conversations ?? 0,
        tokens: u.tokens ?? null,
      })
      .onConflictDoUpdate({
        target: [usageDaily.day, usageDaily.model],
        set: {
          costMicroUsd: sql`${usageDaily.costMicroUsd} + ${u.costMicroUsd}`,
          conversations: sql`${usageDaily.conversations} + ${u.conversations ?? 0}`,
        },
      }),
  );
}

export async function dailyCost(db: Executor, day: string): Promise<number> {
  const { rows } = await db.execute<{ s: string }>(
    sql`select coalesce(sum(cost_micro_usd), 0)::text as s from ai.usage_daily where day = ${day}::date`,
  );
  return Number(rows[0]?.s ?? 0);
}

/** Retention: removes conversations past purge_after with their messages (the only way messages leave the database). */
export async function purgeExpiredConversations(db: Executor, now: Date = new Date()): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select ai.purge_expired(${now.toISOString()}::timestamptz) as n`,
  );
  return Number(rows[0]?.n ?? 0);
}
