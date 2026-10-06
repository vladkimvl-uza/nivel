import { bigint, index, jsonb, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { pk, tstz } from "../repos/columns.ts";
import { consents } from "./ops.ts";

/** PostgreSQL schema "bot" (ARCHITECTURE 3.1, 3.3). */
export const bot = pgSchema("bot");

/** grammY session storage: step, language, draft. */
export const sessions = bot.table("sessions", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

/** Telegram update ids already handled (idempotent webhook); kept for 7 days. */
export const processedUpdates = bot.table(
  "processed_updates",
  {
    updateId: bigint("update_id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("processed_updates_at_idx").on(t.at)],
);

export const subscriptions = bot.table(
  "subscriptions",
  {
    id: pk(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    topic: text("topic").notNull(),
    consentId: uuid("consent_id").references(() => consents.id),
    unsubscribedAt: tstz("unsubscribed_at"),
  },
  (t) => [unique("subscriptions_user_topic_key").on(t.telegramUserId, t.topic)],
);
