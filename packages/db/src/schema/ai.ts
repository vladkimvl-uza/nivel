import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { oneOf, pk, tstz } from "../repos/columns.ts";
import { configurations, leads } from "./sales.ts";

/** PostgreSQL schema "ai" (ARCHITECTURE 3.1, 3.3). */
export const ai = pgSchema("ai");

export const conversations = ai.table(
  "conversations",
  {
    id: pk(),
    channel: text("channel").notNull(),
    lang: text("lang").$type<"uz" | "ru">().notNull(),
    model: text("model").notNull(),
    mode: text("mode").$type<"full" | "economy">().notNull().default("full"),
    /** Hash only; no personal reference of the visitor. */
    userRefHash: text("user_ref_hash"),
    configurationId: uuid("configuration_id").references(() => configurations.id),
    leadId: uuid("lead_id").references(() => leads.id),
    outcome: text("outcome").$type<"lead" | "escalated" | "abandoned" | "limit">(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    filterHits: integer("filter_hits").notNull().default(0),
    startedAt: tstz("started_at").notNull().defaultNow(),
    /** Start + 90 days; ai.purge_expired() removes the conversation and its messages. */
    purgeAfter: tstz("purge_after").notNull().default(sql`now() + interval '90 days'`),
  },
  (t) => [
    index("conversations_purge_idx").on(t.purgeAfter),
    check("conversations_lang_chk", oneOf(t.lang, ["uz", "ru"])),
    check("conversations_mode_chk", oneOf(t.mode, ["full", "economy"])),
    check("conversations_outcome_chk", oneOf(t.outcome, ["lead", "escalated", "abandoned", "limit"])),
    check("conversations_cost_chk", sql`${t.costMicroUsd} >= 0`),
  ],
);

/** Append-only: exactly what went to the API (after personal data scrubbing) and what the visitor saw. */
export const messages = ai.table(
  "messages",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant" | "tool">().notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    shownText: text("shown_text"),
    displaySubstitution: jsonb("display_substitution").$type<unknown>(),
    requestId: text("request_id"),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    latencyMs: integer("latency_ms"),
    stopReason: text("stop_reason"),
    toolCalls: jsonb("tool_calls").$type<unknown[]>(),
    guardEvents: jsonb("guard_events").$type<unknown[]>(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.seq] }),
    check("messages_role_chk", oneOf(t.role, ["user", "assistant", "tool"])),
    check("messages_seq_chk", sql`${t.seq} > 0`),
  ],
);

/** Kept for 12 months. */
export const usageDaily = ai.table(
  "usage_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    model: text("model").notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    conversations: integer("conversations").notNull().default(0),
    tokens: jsonb("tokens").$type<Record<string, number>>(),
  },
  (t) => [primaryKey({ columns: [t.day, t.model] }), check("usage_daily_cost_chk", sql`${t.costMicroUsd} >= 0`)],
);
