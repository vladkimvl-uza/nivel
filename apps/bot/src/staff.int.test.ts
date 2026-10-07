import { ops, sales } from "@nivel/db/repos";
import { leads } from "@nivel/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Call, inlineButtons, type Person } from "./testing/fake-telegram.ts";
import { acceptedOrder, customerWithLead, type LeadCase, sentOrder } from "./testing/flow.ts";
import { ASSISTANT, createHarness, type Harness, newPerson, OWNER, STRANGER } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";
import { openLeadTopic } from "./topics.ts";

// The roads of a whole order are long; a machine busy with other builds needs more than the 30 seconds of the project.
vi.setConfig({ testTimeout: 180_000 });

let w: BotWorld;
let h: Harness;
let ali: Person;
let lead: LeadCase;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
  await ops.setSetting(w.db, "telegram.assistant_ids", [String(ASSISTANT.id)], "test");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  ali = newPerson("Ali", "ali_uz", "uz");
  h = createHarness(w);
  lead = await customerWithLead(w, h, ali);
  h.tg.reset();
});

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
/** A message in the topic of the lead, from `who`. */
const inTopic = (who: Person, fields: Record<string, unknown>, topic = lead.topicId) =>
  h.send(h.tg.groupMessage(w.groupId, who, fields, topic));
const toCustomer = (calls: Call[]) => calls.filter((c) => c.payload.chat_id === ali.id);

describe("the answer of the owner in the topic goes to the customer", () => {
  it("is copied as it is, and the time of the first answer is written on the request", async () => {
    await inTopic(OWNER, { text: "Salom! Smeta ertaga tayyor." });
    const copies = h.tg.of("copyMessage");
    expect(copies).toHaveLength(1);
    expect(copies[0]?.payload).toMatchObject({ chat_id: ali.id, from_chat_id: w.groupId });
    expect(h.tg.of("sendMessage")).toHaveLength(0);
    const [row] = await q("select first_response_at from sales.leads where id = $1", [lead.leadId]);
    expect(row.first_response_at).not.toBeNull();
  });

  it("the assistant answers too", async () => {
    await inTopic(ASSISTANT, { text: "Yaxshi kun" });
    expect(h.tg.of("copyMessage")).toHaveLength(1);
  });

  it("lines that begin with // stay in the group: the customer gets the text without them", async () => {
    await inTopic(OWNER, { text: "Good day\n// he asked twice already\nThe estimate is ready" });
    expect(h.tg.of("copyMessage")).toHaveLength(0);
    expect(toCustomer(h.tg.of("sendMessage")).map((c) => c.payload.text)).toEqual(["Good day\nThe estimate is ready"]);
  });

  it("a message of notes only is not sent at all", async () => {
    await inTopic(OWNER, { text: "// call him tomorrow\n// and ask about the case" });
    expect(h.tg.calls.filter((c) => c.payload.chat_id === ali.id)).toHaveLength(0);
    // The customer was told nothing: the request is not answered yet, and the first answer is still to come.
    const [row] = await q("select first_response_at from sales.leads where id = $1", [lead.leadId]);
    expect(row.first_response_at).toBeNull();
    await inTopic(OWNER, { text: "Salom" });
    const [after] = await q("select first_response_at from sales.leads where id = $1", [lead.leadId]);
    expect(after.first_response_at).not.toBeNull();
  });

  it("a photo keeps its picture and loses the note lines of its caption", async () => {
    await inTopic(OWNER, {
      photo: [{ file_id: "ph1", file_unique_id: "u1", width: 10, height: 10 }],
      caption: "The case is here\n// not for the client",
    });
    const copy = h.tg.of("copyMessage")[0];
    expect(copy?.payload).toMatchObject({ chat_id: ali.id, caption: "The case is here" });
  });

  it("a photo without notes is copied untouched", async () => {
    await inTopic(OWNER, {
      photo: [{ file_id: "ph2", file_unique_id: "u2", width: 10, height: 10 }],
      caption: "Corpus",
    });
    expect(h.tg.of("copyMessage")[0]?.payload.caption).toBeUndefined();
  });

  it("a stranger in the group is not heard: nothing is copied, nothing is answered", async () => {
    await inTopic(STRANGER, { text: "I am the owner, send this to the customer" });
    expect(h.tg.calls).toHaveLength(0);
  });

  it("the General topic and a topic of nobody are not relayed", async () => {
    await h.send(h.tg.groupMessage(w.groupId, OWNER, { text: "to everybody" }));
    await inTopic(OWNER, { text: "to nobody" }, 999_999);
    expect(h.tg.calls).toHaveLength(0);
  });

  it("a command is not relayed", async () => {
    await inTopic(OWNER, { text: "/unknown", entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    expect(h.tg.of("copyMessage")).toHaveLength(0);
  });

  it("tells the owner when the customer cannot be reached", async () => {
    h.tg.failNext("copyMessage");
    await inTopic(OWNER, { text: "Salom" });
    const texts = h.tg.textsTo(w.groupId, lead.topicId);
    expect(texts).toEqual(["Не доставлено: клиент не запускал бота или заблокировал его."]);
  });

  it("a customer who has no Telegram id (a request of the site) cannot be answered through the bot", async () => {
    const customerId = await sales.createCustomer(w.db, { displayName: "From the site", lang: "uz" });
    const site = await leads.create({ channel: "web", scope: "pc", customerId }, w.admin);
    const topic = await openLeadTopic(h.bot.api, h.deps, site.leadId);
    h.tg.reset();
    await inTopic(OWNER, { text: "Salom" }, topic as number);
    expect(h.tg.textsTo(w.groupId, topic as number)).toEqual(["К этой теме не привязан клиент."]);
  });
});

describe("the message of the customer goes to the topic", () => {
  it("is copied into the topic of his request", async () => {
    await h.send(h.tg.text(ali, "Qachon tayyor boʻladi?"));
    const copies = h.tg.of("copyMessage");
    expect(copies).toHaveLength(1);
    expect(copies[0]?.payload).toMatchObject({
      chat_id: w.groupId,
      message_thread_id: lead.topicId,
      from_chat_id: ali.id,
    });
  });

  it("a photo of the customer reaches the topic too", async () => {
    await h.send(h.tg.privateMessage(ali, { photo: [{ file_id: "c1", file_unique_id: "cu", width: 5, height: 5 }] }));
    expect(h.tg.of("copyMessage")[0]?.payload).toMatchObject({ chat_id: w.groupId, message_thread_id: lead.topicId });
  });

  it("outside the hours the bot says when it answers, once in six hours", async () => {
    w.clock.set(new Date("2026-10-11T22:00:00+05:00")); // Sunday night
    try {
      await h.send(h.tg.text(ali, "Salom"));
      const answers = h.tg.textsTo(ali.id);
      expect(answers).toHaveLength(1);
      expect(answers[0]).toContain("Hozir ish vaqti emas");
      expect(answers[0]).toContain("12.10.2026 10:00");
      await h.send(h.tg.text(ali, "Yana bir savol"));
      expect(h.tg.textsTo(ali.id)).toHaveLength(1);
      expect(h.tg.of("copyMessage")).toHaveLength(2);
      w.clock.advance(7 * 3_600_000);
      await h.send(h.tg.text(ali, "Hali ham kutyapman"));
      expect(h.tg.textsTo(ali.id)).toHaveLength(2);
    } finally {
      w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    }
  });

  it("within the hours there is no automatic answer", async () => {
    await h.send(h.tg.text(ali, "Salom"));
    expect(h.tg.textsTo(ali.id)).toHaveLength(0);
  });

  it("before the opening of the same working day it names the same morning, in Russian for a Russian customer", async () => {
    const dilya = newPerson("Dilya", "dilya", "ru");
    const l2 = await customerWithLead(w, h, dilya);
    h.tg.reset();
    w.clock.set(new Date("2026-10-13T08:30:00+05:00")); // Tuesday, before 10:00
    try {
      await h.send(h.tg.text(dilya, "Здравствуйте"));
      expect(h.tg.textsTo(dilya.id)[0]).toContain("13.10.2026 10:00");
      expect(h.tg.textsTo(dilya.id)[0]).toContain("Сейчас нерабочее время");
      expect(l2.topicId).toBeGreaterThan(0);
    } finally {
      w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    }
  });

  it("a topic that was deleted in Telegram is made again: the message arrives in the new one, the customer notices nothing", async () => {
    h.tg.failNext("copyMessage", { error_code: 400, description: "Bad Request: message thread not found" });
    await h.send(h.tg.text(ali, "Qachon tayyor boʻladi?"));
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [lead.leadId]);
    expect(row.tg_topic_id).not.toBeNull();
    expect(Number(row.tg_topic_id)).not.toBe(lead.topicId);
    // The card of the request is in the new topic, and the message was copied there after it.
    expect(h.tg.of("createForumTopic")).toHaveLength(1);
    expect(h.tg.textsTo(w.groupId, Number(row.tg_topic_id))).toHaveLength(1);
    const copies = h.tg.of("copyMessage").filter((c) => c.payload.chat_id === w.groupId);
    expect(copies.map((c) => c.payload.message_thread_id)).toEqual([lead.topicId, Number(row.tg_topic_id)]);
    expect(h.tg.textsTo(ali.id)).toEqual([]);
  });

  it("a message the group cannot take is not lost in silence: the customer is told to send it again", async () => {
    h.tg.failNext("copyMessage", { error_code: 400, description: "Bad Request: chat not found" });
    const errors = await h.send(h.tg.text(ali, "Salom"), { allowErrors: true });
    expect(errors).toEqual([]);
    expect(h.tg.textsTo(ali.id)).toEqual(["Xabar ustaga yetkazilmadi. Birozdan soʻng qayta yuboring."]);
    // The topic is still the topic of the request: a chat that cannot be reached is not a deleted topic.
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [lead.leadId]);
    expect(Number(row.tg_topic_id)).toBe(lead.topicId);
  });

  it("when the new topic fails as well the customer is told to send it again", async () => {
    h.tg.failNext("copyMessage", { error_code: 400, description: "Bad Request: message thread not found" });
    h.tg.failNext("copyMessage", { error_code: 400, description: "Bad Request: message thread not found" });
    await h.send(h.tg.text(ali, "Salom"), { allowErrors: true });
    expect(h.tg.textsTo(ali.id)).toEqual(["Xabar ustaga yetkazilmadi. Birozdan soʻng qayta yuboring."]);
  });

  it("a customer without any topic is told how to use the bot", async () => {
    const eve = newPerson("Eve", "eve", "uz");
    const { onboard } = await import("./testing/harness.ts");
    await onboard(h, eve, "uz");
    h.tg.reset();
    await h.send(h.tg.text(eve, "Salom"));
    expect(h.tg.textsTo(eve.id)).toEqual(["Tugmalardan foydalaning yoki /start ni bosing."]);
  });
});

describe("the card of the request", () => {
  const press = (who: Person, data: string, topic = lead.topicId) =>
    h.send(h.tg.press(who, w.groupId, 3000, data, topic));
  const hex = () => lead.leadId.replaceAll("-", "");

  it("«In work» takes the request into review and says so in the topic", async () => {
    await press(OWNER, `l:${hex()}:wk`);
    expect((await q("select status from sales.leads where id = $1", [lead.leadId]))[0].status).toBe("in_review");
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual([`Заявка ${lead.leadNumber} в работе.`]);
  });

  it("«Spam» closes it", async () => {
    await press(OWNER, `l:${hex()}:sp`);
    expect((await q("select status, reject_reason from sales.leads where id = $1", [lead.leadId]))[0]).toMatchObject({
      status: "spam",
    });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual([`Заявка ${lead.leadNumber} отмечена как спам.`]);
  });

  it("a request that is not open any more cannot be taken again", async () => {
    await press(OWNER, `l:${hex()}:sp`);
    h.tg.reset();
    await press(ASSISTANT, `l:${hex()}:wk`);
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual(["Заявка уже закрыта."]);
  });

  it("«Address» shows the address from the database, or says there is none", async () => {
    await press(OWNER, `l:${hex()}:ad`);
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual(["Адрес не указан: внесите его в админке."]);
    await q("update sales.customers set address = 'Chilonzor, 7-kvartal, 12' where id = $1", [lead.customerId]);
    h.tg.reset();
    await press(OWNER, `l:${hex()}:ad`);
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual(["Адрес клиента: Chilonzor, 7-kvartal, 12"]);
  });

  it("a stranger presses nothing: the toast says so and nothing changes", async () => {
    await press(STRANGER, `l:${hex()}:sp`);
    expect((await q("select status from sales.leads where id = $1", [lead.leadId]))[0].status).toBe("new");
    expect(h.tg.of("answerCallbackQuery").at(-1)?.payload).toMatchObject({
      text: "Команды в группе принимаются только от владельца и помощника.",
      show_alert: true,
    });
    expect(h.tg.of("sendMessage")).toHaveLength(0);
  });

  it("a button of an unknown request or a made-up id changes nothing", async () => {
    await press(OWNER, "l:0190a1b2c3d47e5f8a9b0c1d2e3f4a5b:sp");
    await press(OWNER, "l:zz:sp");
    await press(OWNER, `l:${hex()}:zz`);
    expect((await q("select status from sales.leads where id = $1", [lead.leadId]))[0].status).toBe("new");
  });
});

describe("the card of the order and the buttons of the events", () => {
  const press = (who: Person, data: string, topic = lead.topicId) =>
    h.send(h.tg.press(who, w.groupId, 3000, data, topic));

  it("/card without an order says the order is not made yet", async () => {
    await inTopic(OWNER, { text: "/card", entities: [{ type: "bot_command", offset: 0, length: 5 }] });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual(["Для этой темы заказа ещё нет: откройте заявку в админке."]);
  });

  it("/card outside a topic says where it works", async () => {
    await h.send(
      h.tg.groupMessage(w.groupId, OWNER, { text: "/card", entities: [{ type: "bot_command", offset: 0, length: 5 }] }),
    );
    expect(h.tg.textsTo(w.groupId)).toEqual(["Команда работает внутри темы заявки."]);
  });

  it("shows the order of the topic: number, status, the fee and the limit of purchases, and the buttons the status allows", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await inTopic(OWNER, { text: "/card", entities: [{ type: "bot_command", offset: 0, length: 5 }] });
    const card = h.tg.of("sendMessage")[0];
    expect(String(card?.payload.text)).toContain(`${o.number} · Принято, ждём оплату`);
    expect(String(card?.payload.text)).toMatch(/Плата: .*сум; лимит закупки: .*сум/);
    expect(inlineButtons(card).map((b) => b.callback_data)).toEqual([
      `o:${o.number}:ev:MEETING_DONE`,
      `o:${o.number}:ev:START_PURCHASE`,
    ]);
    expect(inlineButtons(card).map((b) => b.text)).toEqual(["Встреча проведена", "Начать закупку"]);
  });

  it("the assistant sees no button of money", async () => {
    await acceptedOrder(w, lead);
    h.tg.reset();
    await inTopic(ASSISTANT, { text: "/card", entities: [{ type: "bot_command", offset: 0, length: 5 }] });
    expect(inlineButtons(h.tg.of("sendMessage")[0])).toEqual([]);
  });

  it("a press dispatches the event as the owner under his Telegram id and refreshes the card", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await press(OWNER, `o:${o.number}:ev:MEETING_DONE`);
    const [row] = await q("select first_order_meeting_done from sales.orders where id = $1", [o.orderId]);
    expect(row.first_order_meeting_done).toBe(true);
    const journal = await q(
      "select actor_kind, actor_id, event from sales.order_events where order_id = $1 order by seq desc limit 1",
      [o.orderId],
    );
    expect(journal[0]).toMatchObject({ actor_kind: "owner", actor_id: String(OWNER.id) });
    expect(journal[0].event).toMatchObject({ type: "MEETING_DONE" });
    expect(h.tg.of("editMessageText")).toHaveLength(1);
  });

  it("shows the refusal of the automaton in Russian, in a window, and changes nothing", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await press(OWNER, `o:${o.number}:ev:START_PURCHASE`);
    const toast = h.tg.of("answerCallbackQuery").at(-1)?.payload;
    expect(toast).toMatchObject({ text: "Отказ: Нет подтверждённых платежей.", show_alert: true });
    expect((await q("select status from sales.orders where id = $1", [o.orderId]))[0].status).toBe("accepted");
  });

  it("the assistant cannot press a money button even if he crafts the data: the database refuses him", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await press(ASSISTANT, `o:${o.number}:ev:START_PURCHASE`);
    expect(h.tg.of("answerCallbackQuery").at(-1)?.payload).toMatchObject({
      text: "Отказ: Это действие вам недоступно.",
      show_alert: true,
    });
  });

  it("an id that the lists of the bot name but the database does not know as an active member of the staff is refused", async () => {
    const o = await acceptedOrder(w, lead);
    const ghost = newPerson("Ghost", "ghost"); // no account in the admin panel at all
    const former = newPerson("Former", "former"); // an account that was switched off
    const wrongRole = newPerson("Helper", "helper2"); // an assistant that the list of the bot calls an owner
    await ops.createAdminUser(w.db, {
      email: `former-${former.id}@nivel.test`,
      passwordHash: "x",
      role: "owner",
      telegramUserId: former.id,
    });
    await w.db.$client.query("update ops.admin_users set active = false where telegram_user_id = $1", [former.id]);
    await ops.createAdminUser(w.db, {
      email: `helper-${wrongRole.id}@nivel.test`,
      passwordHash: "x",
      role: "assistant",
      telegramUserId: wrongRole.id,
    });
    const hh = createHarness(w, { ownerIds: [String(ghost.id), String(former.id), String(wrongRole.id)] });
    const eventsBefore = (await q("select 1 from sales.order_events where order_id = $1", [o.orderId])).length;
    for (const who of [ghost, former, wrongRole]) {
      hh.tg.reset();
      await hh.send(hh.tg.press(who, w.groupId, 6100, `o:${o.number}:ev:MEETING_DONE`, lead.topicId));
      expect(hh.tg.of("answerCallbackQuery").at(-1)?.payload).toMatchObject({
        text: "Отказ: Это действие вам недоступно.",
        show_alert: true,
      });
    }
    expect((await q("select 1 from sales.order_events where order_id = $1", [o.orderId])).length).toBe(eventsBefore);
    expect((await q("select first_order_meeting_done from sales.orders where id = $1", [o.orderId]))[0]).toEqual({
      first_order_meeting_done: false,
    });
  });

  it("an event outside the list of the buttons is never dispatched", async () => {
    const o = await acceptedOrder(w, lead);
    const count = async () =>
      (await q("select count(*)::int as n from sales.order_events where order_id = $1", [o.orderId]))[0].n;
    const before = await count();
    h.tg.reset();
    for (const ev of ["HANDOVER", "CANCEL", "FUNDS_RECEIVED", "constructor", "ACCEPT"]) {
      await press(OWNER, `o:${o.number}:ev:${ev}`);
    }
    expect(await count()).toBe(before);
    expect(h.tg.of("editMessageText")).toHaveLength(0);
  });

  it("a stranger cannot press the buttons of an order", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await press(STRANGER, `o:${o.number}:ev:MEETING_DONE`);
    expect(
      (await q("select first_order_meeting_done from sales.orders where id = $1", [o.orderId]))[0]
        .first_order_meeting_done,
    ).toBe(false);
  });

  it("an order of a customer that is not in this topic is not touched by a button of this topic", async () => {
    const other = await customerWithLead(w, h, newPerson("Bob", "bob", "uz"));
    const o2 = await acceptedOrder(w, other);
    h.tg.reset();
    await press(OWNER, `o:${o2.number}:ev:MEETING_DONE`, lead.topicId);
    expect(
      (await q("select first_order_meeting_done from sales.orders where id = $1", [o2.orderId]))[0]
        .first_order_meeting_done,
    ).toBe(false);
  });

  it("the refresh button redraws the card without any event", async () => {
    const o = await sentOrder(w, lead);
    h.tg.reset();
    await press(OWNER, `o:${o.number}:card`);
    expect(h.tg.of("editMessageText").length + h.tg.of("sendMessage").length).toBeGreaterThan(0);
    expect(
      h.tg
        .of("sendMessage")
        .concat(h.tg.of("editMessageText"))
        .some((c) => String(c.payload.text).includes(o.number)),
    ).toBe(true);
  });
});
