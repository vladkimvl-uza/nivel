import { leads } from "@nivel/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness, newPerson, onboard } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";
import { openLeadTopic, sweepLeadTopics } from "./topics.ts";

let w: BotWorld;
let h: Harness;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => {
  h = createHarness(w);
});

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;

/** A request without a topic yet (what `leads.create` leaves before the bot makes the topic). */
async function newLead(): Promise<string> {
  const person = newPerson("Topic", "topic_user", "uz");
  await onboard(h, person, "uz");
  const [{ id: customerId }] = await q("select id from sales.customers where telegram_user_id = $1", [person.id]);
  const lead = await leads.create({ channel: "bot", scope: "pc", customerId, district: "Chilonzor" }, w.bot);
  h.tg.reset();
  return lead.leadId;
}

describe("the topic of a request is made once", () => {
  it("two makers at the same moment (the answer to the customer and the sweep) make one topic with one card", async () => {
    const id = await newLead();
    // The first maker is slow in Telegram: the second one starts while it is still there.
    h.tg.onNext("createForumTopic", () => new Promise((resolve) => setTimeout(resolve, 150)));
    const [a, b] = await Promise.all([openLeadTopic(h.bot.api, h.deps, id), openLeadTopic(h.bot.api, h.deps, id)]);
    expect(h.tg.of("createForumTopic")).toHaveLength(1);
    expect(h.tg.of("sendMessage").filter((c) => c.payload.chat_id === w.groupId)).toHaveLength(1);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [id]);
    expect(Number(row.tg_topic_id)).toBe(a ?? b);
  });

  it("a topic that lost the race for the request is deleted, not left empty in the group", async () => {
    const id = await newLead();
    // Another process wrote its topic while this one was making its own.
    h.tg.onNext("createForumTopic", async () => {
      await q("update sales.leads set tg_topic_id = 99001 where id = $1", [id]);
    });
    const topic = await openLeadTopic(h.bot.api, h.deps, id);
    expect(topic).toBeNull();
    expect(h.tg.of("deleteForumTopic")).toHaveLength(1);
    expect(h.tg.of("sendMessage").filter((c) => c.payload.chat_id === w.groupId)).toHaveLength(0);
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [id]);
    expect(Number(row.tg_topic_id)).toBe(99001);
  });

  it("when the card cannot be posted the topic is taken back, and the next sweep makes it again", async () => {
    const id = await newLead();
    h.tg.failNext("sendMessage", { error_code: 500, description: "Internal Server Error" });
    await expect(openLeadTopic(h.bot.api, h.deps, id)).rejects.toThrow();
    expect(h.tg.of("deleteForumTopic")).toHaveLength(1);
    const [empty] = await q("select tg_topic_id from sales.leads where id = $1", [id]);
    expect(empty.tg_topic_id).toBeNull();
    await sweepLeadTopics(h.bot.api, h.deps);
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [id]);
    expect(row.tg_topic_id).not.toBeNull();
    expect(h.tg.of("sendMessage").filter((c) => c.payload.chat_id === w.groupId)).toHaveLength(2);
  });
});
