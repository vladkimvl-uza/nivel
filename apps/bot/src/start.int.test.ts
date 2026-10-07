import type { Db } from "@nivel/db";
import { consents } from "@nivel/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureCustomer } from "./store.ts";
import type { Person } from "./testing/fake-telegram.ts";
import { createHarness, type Harness, newPerson, onboard, STRANGER } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

let w: BotWorld;
let h: Harness;
let ALI: Person;
let DILYA: Person;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  // Every test has its own people: the database is shared by the tests of this file.
  ALI = newPerson("Ali", "ali_uz", "uz");
  DILYA = newPerson("Dilya", "dilya", "ru");
  h = createHarness(w);
});

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
const buttons = (call: { payload: Record<string, unknown> } | undefined) =>
  (
    (call?.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined)
      ?.inline_keyboard ?? []
  ).flat();

describe("/start: language, consent, menu", () => {
  it("asks the language first, Uzbek button first, in both languages", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    const sent = h.tg.lastSend(ALI.id);
    expect(sent?.payload.text).toBe("Tilni tanlang / Выберите язык");
    expect(buttons(sent).map((b) => [b.text, b.callback_data])).toEqual([
      ["Oʻzbekcha", "lg:uz"],
      ["Русский", "lg:ru"],
    ]);
  });

  it("does not rely on language_code of Telegram: a Russian client with Uzbek code is still asked", async () => {
    await h.send(h.tg.text({ ...DILYA, language_code: "uz" }, "/start"));
    expect(h.tg.lastSend(DILYA.id)?.payload.text).toBe("Tilni tanlang / Выберите язык");
  });

  it("after the language shows the short notice with the version of the policy and the button of consent", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    const sent = h.tg.lastSend(ALI.id);
    expect(String(sent?.payload.text)).toContain("rozilik");
    expect(String(sent?.payload.text)).toContain("v1");
    expect(buttons(sent).map((b) => [b.text, b.callback_data])).toEqual([["Roziman", "cn:ok"]]);
    expect(h.tg.of("answerCallbackQuery")).toHaveLength(1);
    // Nothing is known about the person yet: no customer, no consent before he agrees.
    expect(await q("select 1 from sales.customers where telegram_user_id = $1", [ALI.id])).toHaveLength(0);
    expect(
      await q("select 1 from ops.consents where evidence ->> 'telegramUserId' = $1", [String(ALI.id)]),
    ).toHaveLength(0);
  });

  it("the consent makes the customer, records pd_processing against the published document and opens the menu", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    await h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok"));
    const customers = await q(
      "select id, lang, display_name, telegram_username from sales.customers where telegram_user_id = $1",
      [ALI.id],
    );
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ lang: "uz", display_name: "Ali", telegram_username: "ali_uz" });
    const consents = await q(
      "select kind, granted, channel, lang, document_id, evidence from ops.consents where customer_id = $1",
      [customers[0].id],
    );
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ kind: "pd_processing", granted: true, channel: "bot", lang: "uz" });
    expect(consents[0].document_id).not.toBeNull();
    expect(consents[0].evidence).toEqual({ messageId: 1002, telegramUserId: ALI.id });
    const menu = h.tg.lastSend(ALI.id);
    expect(menu?.payload.text).toBe("Nima qilamiz?");
    expect(buttons(menu).map((b) => b.text)).toEqual([
      "Kompyuter tanlash",
      "Mening buyurtmam",
      "Aloqa",
      "Muammo haqida xabar berish",
    ]);
  });

  it("a second press of the consent button records nothing twice", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    await h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok"));
    await h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok"));
    expect(
      await q("select 1 from ops.consents where evidence ->> 'telegramUserId' = $1", [String(ALI.id)]),
    ).toHaveLength(1);
    expect(await q("select 1 from sales.customers where telegram_user_id = $1", [ALI.id])).toHaveLength(1);
  });

  it("a returning customer goes straight to the menu in his saved language", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    await h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok"));
    await w.db.$client.query("delete from bot.sessions");
    const fresh = createHarness(w);
    await fresh.send(fresh.tg.text(ALI, "/start"));
    expect(fresh.tg.lastSend(ALI.id)?.payload.text).toBe("Nima qilamiz?");
  });

  it("writes before the consent are refused with the notice, and the contact is never asked", async () => {
    await h.send(h.tg.text(DILYA, "/start"));
    await h.send(h.tg.press(DILYA, DILYA.id, 1001, "lg:ru"));
    await h.send(h.tg.text(DILYA, "Привет, мне нужен компьютер"));
    expect(h.tg.lastSend(DILYA.id)?.payload.text).toBe("Для продолжения нужно согласие.");
    expect(h.tg.calls.some((c) => JSON.stringify(c.payload).includes("request_contact"))).toBe(false);
  });
});

describe("/language", () => {
  it("changes the language of the dialog and of the profile", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    await h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok"));
    await h.send(h.tg.text(ALI, "/language"));
    expect(h.tg.lastSend(ALI.id)?.payload.text).toBe("Tilni tanlang / Выберите язык");
    await h.send(h.tg.press(ALI, ALI.id, 1003, "lg:ru"));
    expect(h.tg.lastSend(ALI.id)?.payload.text).toBe("Что делаем?");
    expect(await q("select lang from sales.customers where telegram_user_id = $1", [ALI.id])).toEqual([{ lang: "ru" }]);
  });
});

describe("what the bot ignores", () => {
  it("an update seen twice (Telegram retries) is handled once", async () => {
    const update = h.tg.text(ALI, "/start");
    await h.send(update);
    await h.send(update);
    expect(h.tg.of("sendMessage")).toHaveLength(1);
  });

  it("groups other than the owner's: nothing is answered", async () => {
    await h.send(
      h.tg.groupMessage(-1_009_999, STRANGER, {
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      }),
    );
    expect(h.tg.calls).toHaveLength(0);
  });

  it("updates without a chat are ignored", async () => {
    await h.send({
      update_id: 99_001,
      inline_query: { id: "1", from: { ...ALI, is_bot: false }, query: "x", offset: "" },
    });
    expect(h.tg.calls).toHaveLength(0);
  });
});

describe("buttons that arrive out of order", () => {
  it("the consent button without a language asks the language first and records nothing", async () => {
    await h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok"));
    expect(h.tg.lastSend(ALI.id)?.payload.text).toBe("Tilni tanlang / Выберите язык");
    expect(await q("select 1 from sales.customers where telegram_user_id = $1", [ALI.id])).toHaveLength(0);
  });

  it("a language button with a language the bot does not have changes nothing", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    h.tg.reset();
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:en"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:"));
    expect(h.tg.of("sendMessage")).toHaveLength(0);
    expect(h.tg.of("answerCallbackQuery")).toHaveLength(2);
  });

  it("a button of the menu pressed before the consent gets the notice, not the feature", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    h.tg.reset();
    await h.send(h.tg.press(ALI, ALI.id, 1002, "m:order"));
    expect(h.tg.lastSend(ALI.id)?.payload.text).toBe("Davom etish uchun rozilik kerak.");
  });
});

describe("the customer record", () => {
  it("two first updates at once make one customer, and both get him", async () => {
    const person = newPerson("Twin", "twin", "uz");
    const make = () =>
      ensureCustomer(w.bot.db, {
        telegramUserId: person.id,
        displayName: "Twin",
        telegramUsername: "twin",
        lang: "uz",
      });
    const [a, b] = await Promise.all([make(), make()]);
    expect(a.id).toBe(b.id);
    expect(await q("select 1 from sales.customers where telegram_user_id = $1", [person.id])).toHaveLength(1);
  });
});

describe("a failure inside the bot", () => {
  it("is logged, and the customer is told to try again instead of being left in silence", async () => {
    const broken = createHarness(w, { db: {} as Db });
    const errors = await broken.send(broken.tg.text(ALI, "/start"), { allowErrors: true });
    expect(errors).toHaveLength(1);
    expect(broken.tg.lastSend(ALI.id)?.payload.text).toBe("Xatolik yuz berdi. Qayta urinib koʻring.");
  });

  it("does not try to answer a chat it cannot (a group): nothing is sent", async () => {
    const broken = createHarness(w, { db: {} as Db });
    await broken.send(broken.tg.groupMessage(w.groupId, STRANGER, { text: "x" }, 5), { allowErrors: true });
    expect(broken.tg.of("sendMessage")).toHaveLength(0);
  });
});

describe("two updates of one person at once", () => {
  it("are handled one after the other: a double tap on «Agree» records one consent", async () => {
    await h.send(h.tg.text(ALI, "/start"));
    await h.send(h.tg.press(ALI, ALI.id, 1001, "lg:uz"));
    await Promise.all([
      h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok")),
      h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok")),
      h.send(h.tg.press(ALI, ALI.id, 1002, "cn:ok")),
    ]);
    expect(
      await q("select 1 from ops.consents where evidence ->> 'telegramUserId' = $1", [String(ALI.id)]),
    ).toHaveLength(1);
  });
});

describe("the consent is asked of the database every time", () => {
  it("a consent that was withdrawn brings the customer back to the consent screen; agreeing again records a new consent", async () => {
    await onboard(h, ALI, "uz");
    const [{ id: customerId }] = await q("select id from sales.customers where telegram_user_id = $1", [ALI.id]);
    await consents.record({ kind: "pd_processing", customerId, granted: false, channel: "bot" }, w.bot);
    h.tg.reset();
    await h.send(h.tg.text(ALI, "Salom"));
    expect(h.tg.of("copyMessage")).toHaveLength(0);
    const sent = h.tg.lastSend(ALI.id);
    expect(String(sent?.payload.text)).toBe("Davom etish uchun rozilik kerak.");
    expect(buttons(sent).map((b) => b.callback_data)).toEqual(["cn:ok"]);
    await h.send(h.tg.press(ALI, ALI.id, 1003, "cn:ok"));
    expect(
      await q("select granted from ops.consents where customer_id = $1 and kind = 'pd_processing' order by at, id", [
        customerId,
      ]),
    ).toEqual([{ granted: true }, { granted: false }, { granted: true }]);
    h.tg.reset();
    await h.send(h.tg.text(ALI, "/start"));
    expect(h.tg.lastSend(ALI.id)?.payload.text).toBe("Nima qilamiz?");
  });
});
