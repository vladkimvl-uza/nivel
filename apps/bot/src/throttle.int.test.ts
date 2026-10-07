import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, newPerson, OWNER } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

let w: BotWorld;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
});
afterAll(async () => {
  await w.close();
});

const processed = async (ids: number[]) =>
  Number(
    (await w.db.$client.query("select count(*)::int as n from bot.processed_updates where update_id = any($1)", [ids]))
      .rows[0].n,
  );

describe("the limit of updates from one person (ARCHITECTURE 10.1)", () => {
  it("what is over the limit never reaches the database; the person is told once; the buttons are answered", async () => {
    let now = 0;
    const h = createHarness(w, {}, { throttle: { burst: 3, perSecond: 1, now: () => now } });
    const spam = newPerson("Spam", "spam", "uz");
    const updates = Array.from({ length: 6 }, () => h.tg.text(spam, "salom"));
    for (const u of updates) await h.send(u);
    expect(await processed(updates.map((u) => u.update_id))).toBe(3);
    expect(h.tg.textsTo(spam.id).filter((t) => t.startsWith("Juda tez"))).toHaveLength(1);
    // A press over the limit still gets its answer: Telegram would show the spinner otherwise.
    const press = h.tg.press(spam, spam.id, 1001, "lg:uz");
    await h.send(press);
    expect(h.tg.of("answerCallbackQuery").at(-1)).toBeDefined();
    expect(await processed([press.update_id])).toBe(0);
    // A second later one more is let through.
    now = 1_000;
    const later = h.tg.text(spam, "salom");
    await h.send(later);
    expect(await processed([later.update_id])).toBe(1);
  });

  it("one person does not use up another's turn, and the owner is not limited", async () => {
    const h = createHarness(w, {}, { throttle: { burst: 1, perSecond: 0.001, now: () => 0 } });
    const a = newPerson("A", "a1", "uz");
    const b = newPerson("B", "b1", "uz");
    const first = [h.tg.text(a, "x"), h.tg.text(b, "x")];
    const second = [h.tg.text(a, "y"), h.tg.text(b, "y")];
    for (const u of [...first, ...second]) await h.send(u);
    expect(await processed(first.map((u) => u.update_id))).toBe(2);
    expect(await processed(second.map((u) => u.update_id))).toBe(0);
    const owner = [h.tg.text(OWNER, "x"), h.tg.text(OWNER, "y"), h.tg.text(OWNER, "z")];
    for (const u of owner) await h.send(u);
    expect(await processed(owner.map((u) => u.update_id))).toBe(3);
  });
});
