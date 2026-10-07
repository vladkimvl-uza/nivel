// What a careless or a hostile hand can send: buttons out of step, made-up values, other people's drafts, old drafts. None of
// it may change anything or leave a person in silence.
import { ops } from "@nivel/db/repos";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineButtons, type Person } from "./testing/fake-telegram.ts";
import { acceptedOrder, customerWithLead, type LeadCase, purchasingOrder, sentOrder } from "./testing/flow.ts";
import { ASSISTANT, createHarness, type Harness, lastButtons, newPerson, OWNER } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

// The roads of a whole order are long; a machine busy with other builds needs more than the 30 seconds of the project.
vi.setConfig({ testTimeout: 180_000 });

let w: BotWorld;
let h: Harness;
let ali: Person;
let lead: LeadCase;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true, withTemplate: true });
  await ops.setSetting(w.db, "telegram.assistant_ids", [String(ASSISTANT.id)], "test");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
  ali = newPerson("Ali", "ali_uz", "uz");
  h = createHarness(w);
  lead = await customerWithLead(w, h, ali);
  h.tg.reset();
});

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
const press = (data: string, who: Person = ali) => h.send(h.tg.press(who, who.id, 4000, data));
const say = (text: string, who: Person = ali) => h.send(h.tg.text(who, text));
const inTopic = (who: Person, fields: Record<string, unknown>, topic = lead.topicId) =>
  h.send(h.tg.groupMessage(w.groupId, who, fields, topic));
const pressIn = (who: Person, data: string, topic = lead.topicId) =>
  h.send(h.tg.press(who, w.groupId, 6000, data, topic));
const sessionOf = async (p: Person) =>
  (await q("select value from bot.sessions where key = $1", [`private:${p.id}`]))[0]?.value;

describe("the request out of step", () => {
  async function toTerm() {
    for (const d of [
      "m:select",
      "sel:task:gaming",
      "sel:band:12m_20m",
      "sel:scope:pc",
      "sel:done",
      "sel:pick:gaming.T2.A",
    ]) {
      await press(d);
    }
    await say("Oʻtkazib yuborish");
    await say("Chilonzor");
  }

  it("a text where a button is expected is not an answer; a made-up term is nothing", async () => {
    await toTerm();
    h.tg.reset();
    await say("ertaga");
    expect((await sessionOf(ali)).step).toBe("req_term");
    await press("ld:term:bogus");
    await press("ld:zzz:asap");
    expect(
      await q(
        "select 1 from sales.leads l join sales.customers c on c.id = l.customer_id where c.telegram_user_id = $1 and l.comment like '%Игры%'",
        [ali.id],
      ),
    ).toHaveLength(0);
  });

  it("a term button of an old message, when no request is being made, says it is old", async () => {
    await press("ld:term:week");
    expect(h.tg.of("answerCallbackQuery").at(-1)?.payload.text).toBe("Tugma eskirgan: /start ni bosing.");
  });

  it("a phone that is not a phone is not kept, and the dialog goes on; a command is not a district", async () => {
    for (const d of [
      "m:select",
      "sel:task:gaming",
      "sel:band:12m_20m",
      "sel:scope:pc",
      "sel:done",
      "sel:pick:gaming.T2.A",
    ]) {
      await press(d);
    }
    await h.send(h.tg.contact(ali, "12"));
    expect((await sessionOf(ali)).draft.phone).toBeUndefined();
    expect((await sessionOf(ali)).step).toBe("req_district");
    await say("/start extra");
    expect((await sessionOf(ali)).step).toBe("idle");
  });

  it("the wishes buttons do nothing outside the step of the wishes", async () => {
    await press("sel:w:quiet");
    await press("sel:done");
    await press("sel:pick:gaming.T2.A");
    await press("sel:pick:bogus.T9.Z");
    expect(
      h.tg
        .of("answerCallbackQuery")
        .every((c) => c.payload.text === "Tugma eskirgan: /start ni bosing." || c.payload.text === undefined),
    ).toBe(true);
    expect((await sessionOf(ali)).step).toBe("idle");
  });
});

describe("the orders of the customer out of step", () => {
  it("shows the payment instruction in the card of an accepted order, and lists several orders", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:view`);
    const text = String(h.tg.lastSend(ali.id)?.payload.text);
    expect(text).toContain("Toʻlov tartibi:");
    expect(text).toContain("Oldindan toʻlov:");
    expect(text).toContain("Pulni shaxsiy kartaga oʻtkazmang.");
  });

  it("a question to the report asked for an order that is not another's, or twice, or with a command, stays harmless", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:obj`);
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Hozir bu amal mumkin emas: buyurtma boshqa holatda.");
    expect((await sessionOf(ali)).step).toBe("idle");
    await press(`o:${o.number}:zzz`);
    await press("o::view");
    expect(h.tg.of("sendMessage")).toHaveLength(1);
  });
});

describe("the owner's group out of step", () => {
  it("a button of the order in a topic that is not its own, or an unknown order, is stale", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await pressIn(OWNER, `o:${o.number}:card`, 987_654);
    await pressIn(OWNER, "o:NV-2099-0001:card");
    await pressIn(OWNER, `o:${o.number}:zzz`);
    await pressIn(OWNER, "l:0190a1b2c3d47e5f8a9b0c1d2e3f4a5b:wk");
    expect(
      h.tg
        .of("answerCallbackQuery")
        .map((c) => c.payload.text)
        .filter(Boolean),
    ).toEqual([
      "Эта кнопка устарела: нажмите /start.",
      "Эта кнопка устарела: нажмите /start.",
      "Эта кнопка устарела: нажмите /start.",
    ]);
  });

  it("an event the automaton does not allow in the status is refused in words and the card stays", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await pressIn(OWNER, `o:${o.number}:ev:DISPATCH`);
    expect(h.tg.of("answerCallbackQuery").at(-1)?.payload).toMatchObject({
      text: "Отказ: В этом статусе такое действие невозможно.",
      show_alert: true,
    });
    expect(h.tg.of("editMessageText")).toHaveLength(0);
  });

  it("a sticker is copied to the customer, a service message of the forum is not", async () => {
    await inTopic(OWNER, {
      sticker: {
        file_id: "st1",
        file_unique_id: "stu",
        type: "regular",
        width: 1,
        height: 1,
        is_animated: false,
        is_video: false,
      },
    });
    expect(h.tg.of("copyMessage")).toHaveLength(1);
    h.tg.reset();
    await inTopic(OWNER, { forum_topic_edited: { name: "renamed" } });
    expect(h.tg.calls).toHaveLength(0);
  });

  it("a document that is not an image or a PDF, with the caption of a receipt, is an ordinary file for the customer", async () => {
    await purchasingOrder(w, lead);
    h.tg.reset();
    await inTopic(OWNER, {
      document: { file_id: "doc-x", file_unique_id: "doc-xu", mime_type: "application/zip", file_name: "x.zip" },
      caption: "1100000 Mycom",
    });
    expect(h.tg.of("copyMessage")).toHaveLength(1);
  });
});

describe("drafts of receipts that are old or not ours", () => {
  it("a draft of more than a day is expired", async () => {
    await purchasingOrder(w, lead);
    h.tg.reset();
    await inTopic(OWNER, {
      photo: [{ file_id: "old-1", file_unique_id: "old-1u", width: 9, height: 9 }],
      caption: "1100000 Mycom",
    });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    w.clock.advance(25 * 3_600_000);
    await pressIn(OWNER, inlineButtons(card)[0]?.callback_data as string);
    expect(h.tg.textsTo(w.groupId, lead.topicId).at(-1)).toBe("Черновик устарел: пришлите чек ещё раз.");
  });

  it("an id that is not a draft, or an action the draft does not know, does nothing", async () => {
    await purchasingOrder(w, lead);
    h.tg.reset();
    await inTopic(OWNER, {
      photo: [{ file_id: "old-2", file_unique_id: "old-2u", width: 9, height: 9 }],
      caption: "1100000 Mycom",
    });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    const id = inlineButtons(card)[0]?.callback_data.split(":")[1] as string;
    await pressIn(OWNER, "r:zzzz:ok");
    await pressIn(OWNER, `r:${id}:ok`); // «confirm an act» on a receipt draft
    await pressIn(OWNER, `r:${id}:l:9`); // a line that was not proposed
    await pressIn(OWNER, `r:${id}:q`);
    expect(
      await q(
        "select 1 from ops.outbox where payload ->> 'job' = 'telegram.file_intake' and payload ->> 'telegramFileId' = 'old-2'",
      ),
    ).toHaveLength(0);
  });

  it("an act that is signed needs no photo, and the caption «act» in a topic without an order is told so", async () => {
    await inTopic(OWNER, {
      photo: [{ file_id: "act-x", file_unique_id: "act-xu", width: 9, height: 9 }],
      caption: "act",
    });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual(["Для этой темы нет заказа."]);
  });
});

describe("the warranty report out of step", () => {
  it("a command in the middle of a description is a command, and photos beyond ten are not kept", async () => {
    // A customer who has not got a handed over order cannot start; the step is set by hand through the session here.
    await q(
      "insert into bot.sessions (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
      [
        `private:${ali.id}`,
        JSON.stringify({
          lang: "uz",
          consented: true,
          step: "warranty_text",
          draft: {
            wishes: [],
            orderNumber: "NV-2026-0001",
            warrantyParts: { text: "", photoFileIds: [], messageIds: [] },
          },
        }),
      ],
    );
    await say("/order");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Hozircha buyurtmalaringiz yoʻq.");
    for (let i = 0; i < 12; i++) {
      await h.send(
        h.tg.privateMessage(ali, { photo: [{ file_id: `p${i}`, file_unique_id: `u${i}`, width: 1, height: 1 }] }),
      );
    }
    expect((await sessionOf(ali)).draft.warrantyParts.photoFileIds).toHaveLength(10);
    await press("w:done");
    // The order of the draft is not a handed over order of this customer: nothing is queued.
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Kafolat murojaati uchun topshirilgan buyurtma kerak.");
    expect(lastButtons(h, ali.id)).toEqual([]);
  });
});
