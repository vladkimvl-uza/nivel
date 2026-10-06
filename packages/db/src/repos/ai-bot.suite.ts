import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import {
  addConversationUsage,
  addDailyUsage,
  appendMessage,
  dailyCost,
  listMessages,
  purgeExpiredConversations,
  startConversation,
} from "./ai.ts";
import {
  deleteSession,
  getSession,
  listSubscribers,
  markUpdateProcessed,
  purgeProcessedUpdates,
  saveSession,
  subscribe,
  unsubscribe,
} from "./bot.ts";
import { connectAs, openDb, uniq } from "./testkit.ts";

let web: Db;
let bot: Db;
let admin: Db;

beforeAll(() => {
  web = openDb("WEB");
  bot = openDb("BOT");
  admin = openDb("ADMIN");
});
afterAll(async () => {
  for (const d of [web, bot, admin]) await d.$client.end();
});

describe("AI journal (written by the site role)", () => {
  it("numbers messages one after another, keeps what went to the API and what the visitor saw", async () => {
    const id = await startConversation(web, { channel: "web", lang: "uz", model: "test-model", mode: "full" });
    expect(await appendMessage(web, id, { role: "user", content: "Salom", shownText: "Salom" })).toBe(1);
    expect(
      await appendMessage(web, id, {
        role: "assistant",
        content: [{ type: "text", text: "Assalomu alaykum" }],
        shownText: "Assalomu alaykum",
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 420,
        stopReason: "end_turn",
        toolCalls: [{ name: "get_policy", input: { topic: "fee" } }],
        guardEvents: [],
        requestId: "req_1",
      }),
    ).toBe(2);
    const rows = await listMessages(web, id);
    expect(rows.map((r) => [r.seq, r.role])).toEqual([
      [1, "user"],
      [2, "assistant"],
    ]);
    expect(rows[1]).toMatchObject({ latencyMs: 420, stopReason: "end_turn", requestId: "req_1" });
    expect(rows[1]?.toolCalls).toEqual([{ name: "get_policy", input: { topic: "fee" } }]);
  });

  it("adds cost and filter hits to the conversation and to the day", async () => {
    const id = await startConversation(web, { channel: "web", lang: "ru", model: "m" });
    await addConversationUsage(web, id, { costMicroUsd: 1500, filterHits: 1 });
    await addConversationUsage(web, id, { costMicroUsd: 500, outcome: "lead" });
    const { rows } = await web.$client.query(
      "select cost_micro_usd::int as c, filter_hits, outcome from ai.conversations where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ c: 2000, filter_hits: 1, outcome: "lead" });
    const day = "2031-01-05";
    await addDailyUsage(web, { day, model: "m", costMicroUsd: 2000, conversations: 1, tokens: { in: 10 } });
    await addDailyUsage(web, { day, model: "m", costMicroUsd: 500, conversations: 1 });
    await addDailyUsage(web, { day, model: "other", costMicroUsd: 100 });
    expect(await dailyCost(web, day)).toBe(2600);
    expect(await dailyCost(web, "2031-01-06")).toBe(0);
  });

  it("removes expired conversations with their messages and only those", async () => {
    const old = await startConversation(admin, { channel: "web", lang: "uz", model: "m" });
    const fresh = await startConversation(admin, { channel: "web", lang: "uz", model: "m" });
    await appendMessage(admin, old, { role: "user", content: "old" });
    await appendMessage(admin, fresh, { role: "user", content: "fresh" });
    await admin.$client.query("update ai.conversations set purge_after = '2020-01-01' where id = $1", [old]);
    expect(await purgeExpiredConversations(admin, new Date())).toBeGreaterThanOrEqual(1);
    expect(await listMessages(admin, old)).toEqual([]);
    expect(await listMessages(admin, fresh)).toHaveLength(1);
    // The 90-day default lies ahead of "now" but behind a date 91 days later.
    expect(await purgeExpiredConversations(admin, new Date(Date.now() + 91 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect(await listMessages(admin, fresh)).toEqual([]);
  });
});

describe("bot storage", () => {
  it("saves, reads, replaces and deletes a session", async () => {
    const key = `chat:${uniq()}`;
    expect(await getSession(bot, key)).toBeNull();
    await saveSession(bot, key, { step: "budget", lang: "uz" });
    await saveSession(bot, key, { step: "style", lang: "uz", draft: { budget: 15_000_000 } });
    expect(await getSession(bot, key)).toEqual({ step: "style", lang: "uz", draft: { budget: 15_000_000 } });
    await deleteSession(bot, key);
    expect(await getSession(bot, key)).toBeNull();
  });

  it("recognises a repeated update and forgets updates older than seven days", async () => {
    const id = 6_000_000_000 + uniq();
    expect(await markUpdateProcessed(bot, id)).toBe(true);
    expect(await markUpdateProcessed(bot, id)).toBe(false);
    const old = 6_100_000_000 + uniq();
    await markUpdateProcessed(bot, old);
    await bot.$client.query("update bot.processed_updates set at = now() - interval '8 days' where update_id = $1", [
      old,
    ]);
    expect(await purgeProcessedUpdates(bot)).toBeGreaterThanOrEqual(1);
    expect(await markUpdateProcessed(bot, old)).toBe(true);
    expect(await markUpdateProcessed(bot, id)).toBe(false);
  });

  it("subscribes, unsubscribes and resubscribes a user to a topic", async () => {
    const user = 5_000_000_000 + uniq();
    const topic = `news-${uniq()}`;
    await subscribe(bot, user, topic);
    await subscribe(bot, user, topic);
    expect(await listSubscribers(bot, topic)).toEqual([user]);
    await unsubscribe(bot, user, topic);
    expect(await listSubscribers(bot, topic)).toEqual([]);
    await subscribe(bot, user, topic);
    expect(await listSubscribers(bot, topic)).toEqual([user]);
    const m = await connectAs("MIGRATOR");
    try {
      const c = await m.query<{ id: string }>(
        "insert into ops.consents (subject_ref_hash, kind, granted) values ('h', 'marketing', true) returning id",
      );
      await subscribe(bot, user, `${topic}-b`, c.rows[0]?.id);
      expect(await listSubscribers(bot, `${topic}-b`)).toEqual([user]);
    } finally {
      await m.end();
    }
  });
});
