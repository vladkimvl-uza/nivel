import { content, ops } from "@nivel/db/repos";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Person } from "./testing/fake-telegram.ts";
import { createHarness, type Harness, newPerson, onboard } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

let w: BotWorld;
let h: Harness;
let ali: Person;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  ali = newPerson("Ali", "ali_uz", "uz");
  h = createHarness(w);
  await onboard(h, ali, "uz");
  h.tg.reset();
});

const say = (text: string) => h.send(h.tg.text(ali, text));
const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;

describe("/support", () => {
  it("gives the hours and the time of the answer from the policy of the owner", async () => {
    await say("/support");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe(
      "Savollar uchun shu yerga yozing. Ish vaqti: du–sha 10:00–19:00 (Toshkent). Usta ish vaqtida 2 soat ichida javob beradi (du–sha 10:00–19:00).",
    );
  });

  it("the menu button does the same", async () => {
    await h.send(h.tg.press(ali, ali.id, 1, "m:support"));
    expect(String(h.tg.lastSend(ali.id)?.payload.text)).toContain("Ish vaqti");
  });
});

describe("/terms and /privacy: the text comes from the policies in the database, the stub is marked", () => {
  it("says the terms are not published while there is none", async () => {
    await say("/terms");
    expect(h.tg.textsTo(ali.id)).toEqual(["Ish shartlari tez orada eʼlon qilinadi."]);
  });

  it("shows the policies of the terms in the language of the customer, a stub with the mark «draft»", async () => {
    await content.addPolicyVersion(
      w.db,
      "fee",
      { uz: "Xizmat haqi smetada koʻrsatiladi.", ru: "Плата указывается в смете." },
      "stub",
    );
    await content.addPolicyVersion(
      w.db,
      "returns",
      { uz: "Qaytarish 14 kun ichida.", ru: "Возврат в течение 14 дней." },
      "approved",
    );
    await say("/terms");
    expect(h.tg.textsTo(ali.id)).toEqual(["Xizmat haqi smetada koʻrsatiladi. (qoralama)", "Qaytarish 14 kun ichida."]);
  });

  it("/privacy gives the short policy and the link to the full text of the site", async () => {
    await say("/privacy");
    expect(h.tg.textsTo(ali.id)).toEqual([
      "Maxfiylik siyosati tez orada eʼlon qilinadi.\nhttps://nivel.test/uz/legal/privacy",
    ]);
    await content.addPolicyVersion(
      w.db,
      "privacy_short",
      { uz: "Maʼlumotlar faqat buyurtma uchun.", ru: "Данные только для заказа." },
      "approved",
    );
    h.tg.reset();
    await say("/privacy");
    expect(h.tg.textsTo(ali.id)).toEqual(["Maʼlumotlar faqat buyurtma uchun.\nhttps://nivel.test/uz/legal/privacy"]);
  });
});

describe("/stop", () => {
  it("takes the customer off the mailings and keeps the service messages", async () => {
    const [{ id }] = await q("select id from sales.customers where telegram_user_id = $1", [ali.id]);
    const consent = await ops.recordConsent(w.bot.db, {
      kind: "marketing",
      customerId: id,
      granted: true,
      channel: "bot",
    });
    await w.bot.db.$client.query(
      "insert into bot.subscriptions (telegram_user_id, topic, consent_id) values ($1, 'marketing', $2)",
      [ali.id, consent],
    );
    await say("/stop");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe(
      "Xabarnomalar toʻxtatildi. Buyurtma boʻyicha xizmat xabarlari kelishda davom etadi.",
    );
    expect(
      (await q("select unsubscribed_at from bot.subscriptions where telegram_user_id = $1", [ali.id]))[0]
        .unsubscribed_at,
    ).not.toBeNull();
    const kinds = await q(
      "select kind, granted from ops.consents where customer_id = $1 and kind = 'marketing' order by at, id",
      [id],
    );
    expect(kinds.map((r) => r.granted)).toEqual([true, false]);
  });

  it("a customer who never subscribed gets the same answer and no new consent", async () => {
    await say("/stop");
    expect(h.tg.lastSend(ali.id)?.payload.text).toContain("Xabarnomalar toʻxtatildi.");
    const [{ id }] = await q("select id from sales.customers where telegram_user_id = $1", [ali.id]);
    expect(await q("select 1 from ops.consents where customer_id = $1 and kind = 'marketing'", [id])).toHaveLength(0);
  });
});
