import { ops } from "@nivel/db/repos";
import { leads } from "@nivel/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inlineButtons, type Person } from "./testing/fake-telegram.ts";
import { createHarness, type Harness, lastButtons, newPerson, onboard } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";
import { sweepLeadTopics } from "./topics.ts";

let w: BotWorld;
let h: Harness;
let ali: Person;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true, withTemplate: true });
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  ali = newPerson("Ali", "ali_uz", "uz");
  h = createHarness(w);
  await onboard(h, ali, "uz");
});

const press = (data: string, who: Person = ali) => h.send(h.tg.press(who, who.id, 2000, data));
const say = (text: string, who: Person = ali) => h.send(h.tg.text(who, text));
const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
const sessionOf = async (p: Person) =>
  (await q("select value from bot.sessions where key = $1", [`private:${p.id}`]))[0]?.value;

/** The customer picks the template of the gaming PC and is asked the contact. */
async function pickBuild(who: Person = ali) {
  for (const d of [
    "m:select",
    "sel:task:gaming",
    "sel:band:12m_20m",
    "sel:scope:pc",
    "sel:done",
    "sel:pick:gaming.T2.A",
  ]) {
    await press(d, who);
  }
}
const leadOf = async (who: Person) =>
  (
    await q(
      `select l.*, c.phone_e164, c.district as customer_district from sales.leads l
         join sales.customers c on c.id = l.customer_id where c.telegram_user_id = $1 order by l.created_at desc`,
      [who.id],
    )
  )[0];

describe("the request: contact, district, term, then a lead", () => {
  it("asks the contact with the button of Telegram and lets the person skip it", async () => {
    await pickBuild();
    const sent = h.tg.lastSend(ali.id);
    expect(sent?.payload.text).toBe("Aloqa uchun kontaktingizni ulashing (ixtiyoriy).");
    const keyboard = (
      sent?.payload.reply_markup as { keyboard: { text: string; request_contact?: boolean }[][] } | undefined
    )?.keyboard;
    expect(keyboard?.flat()).toEqual([
      { text: "Kontaktni ulashish", request_contact: true },
      { text: "Oʻtkazib yuborish" },
    ]);
    await say("Oʻtkazib yuborish");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Qaysi tumandasiz? Faqat tuman, manzil emas.");
    expect((await sessionOf(ali)).step).toBe("req_district");
  });

  it("takes the phone only from the own contact of the person, in the international form", async () => {
    await pickBuild();
    await h.send(
      h.tg.privateMessage(ali, { contact: { phone_number: "998901234567", first_name: "Boshqa", user_id: 42 } }),
    );
    expect((await sessionOf(ali)).step).toBe("req_contact");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Aloqa uchun kontaktingizni ulashing (ixtiyoriy).");
    await h.send(h.tg.contact(ali, "998901234567"));
    expect((await sessionOf(ali)).draft.phone).toBe("+998901234567");
    expect((await sessionOf(ali)).step).toBe("req_district");
  });

  it("refuses a district that is not a short text", async () => {
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("x".repeat(81));
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Tuman nomini matn bilan yozing (80 belgigacha).");
    await h.send(h.tg.privateMessage(ali, { photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] }));
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Tuman nomini matn bilan yozing (80 belgigacha).");
    expect((await sessionOf(ali)).step).toBe("req_district");
  });

  it("asks the term with four buttons", async () => {
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Chilonzor");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Qachongacha kerak?");
    expect(lastButtons(h, ali.id).map(([, data]) => data)).toEqual([
      "ld:term:asap",
      "ld:term:week",
      "ld:term:month",
      "ld:term:later",
    ]);
  });

  it("creates the lead for the customer with what he chose and tells him the number and the time of the answer", async () => {
    await pickBuild();
    await h.send(h.tg.contact(ali, "998901234567"));
    await say("Chilonzor");
    await press("ld:term:week");
    const lead = await leadOf(ali);
    expect(lead).toMatchObject({
      channel: "bot",
      scope: "pc",
      lang: "uz",
      district: "Chilonzor",
      budget_band: "12m_20m",
      status: "new",
      phone_e164: "+998901234567",
    });
    expect(lead.number).toMatch(/^L-2026-\d{4}$/);
    expect(lead.wanted_by).toBeTruthy();
    // The owner reads the comment: it is in Russian, with the choice of the customer.
    expect(lead.comment).toContain("Задача: Игры");
    expect(lead.comment).toContain("12–20 млн сум");
    const answer = h.tg.lastSend(ali.id);
    expect(answer?.payload.text).toBe(
      `Ariza ${lead.number} qabul qilindi. Usta ish vaqtida 2 soat ichida javob beradi (du–sha 10:00–19:00).`,
    );
    expect((answer?.payload.reply_markup as { remove_keyboard?: boolean } | undefined)?.remove_keyboard).toBe(true);
    const session = await sessionOf(ali);
    expect(session.step).toBe("idle");
    expect(session.draft).toEqual({ wishes: [] });
  });

  it("writes the term as a date counted from today in Tashkent, and none for «later»", async () => {
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Yunusobod");
    await press("ld:term:later");
    expect((await leadOf(ali)).wanted_by).toBeNull();
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Yunusobod");
    await press("ld:term:asap");
    const [{ wanted_by }] = await q(
      "select to_char(wanted_by, 'YYYY-MM-DD') as wanted_by from sales.leads order by created_at desc limit 1",
    );
    expect(wanted_by).toBe("2026-10-15");
  });

  it("puts the lead into the outbox for the owner, with a key that does not repeat", async () => {
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Chilonzor");
    await press("ld:term:week");
    const lead = await leadOf(ali);
    const rows = await q("select payload from ops.outbox where dedupe_key = $1", [`lead:${lead.id}:created`]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ target: "owner_topic", templateKey: "lead.created", leadId: lead.id });
  });

  it("opens a topic in the owner's group, names it by the number, the district and the choice, and posts the card with buttons", async () => {
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Chilonzor");
    await press("ld:term:week");
    const lead = await leadOf(ali);
    const created = h.tg.of("createForumTopic");
    expect(created).toHaveLength(1);
    expect(created[0]?.payload).toMatchObject({
      chat_id: w.groupId,
      name: `${lead.number} · Chilonzor · ПК 12–20 млн`,
    });
    expect(lead.tg_topic_id).not.toBeNull();
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    expect(card?.payload.message_thread_id).toBe(Number(lead.tg_topic_id));
    expect(card?.payload.text).toContain(`Новая заявка ${lead.number}`);
    const data = inlineButtons(card).map((b) => b.callback_data);
    expect(data).toHaveLength(3);
    expect(data.every((d) => d.startsWith("l:") && Buffer.byteLength(d) <= 64)).toBe(true);
  });

  it("the lead stands when the topic cannot be made (the bot is not in the group): the sweep makes it later", async () => {
    h.tg.failNext("createForumTopic", {
      error_code: 400,
      description: "Bad Request: not enough rights to create a topic",
    });
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Chilonzor");
    await press("ld:term:week");
    const lead = await leadOf(ali);
    expect(lead.tg_topic_id).toBeNull();
    expect(h.tg.lastSend(ali.id)?.payload.text).toContain(lead.number);
    h.tg.reset();
    const made = await sweepLeadTopics(h.bot.api, h.deps);
    expect(made).toBeGreaterThanOrEqual(1);
    expect((await leadOf(ali)).tg_topic_id).not.toBeNull();
    expect(h.tg.of("createForumTopic")).toHaveLength(made);
    // The second sweep finds nothing to do.
    h.tg.reset();
    expect(await sweepLeadTopics(h.bot.api, h.deps)).toBe(0);
  });

  it("the sweep also takes the requests of the site, which have no topic", async () => {
    const lead = await leads.create(
      {
        channel: "web",
        scope: "pc",
        district: "Mirzo Ulugʻbek",
        budgetSum: 25_000_000,
        customer: { telegramUserId: 7_300_000_001 },
      },
      w.bot,
    );
    h.tg.reset();
    await sweepLeadTopics(h.bot.api, h.deps);
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [lead.leadId]);
    expect(row.tg_topic_id).not.toBeNull();
    expect(h.tg.of("createForumTopic").at(-1)?.payload.name).toContain(
      `${lead.number} · Mirzo Ulugʻbek · ПК 20–35 млн`,
    );
  });

  it("without a group in the settings the lead is made and nothing is posted", async () => {
    await ops.setSetting(w.db, "telegram.owner_group_id", 0, "test");
    try {
      await pickBuild();
      await say("Oʻtkazib yuborish");
      await say("Chilonzor");
      await press("ld:term:week");
      expect((await leadOf(ali)).number).toMatch(/^L-/);
      expect(h.tg.of("createForumTopic")).toHaveLength(0);
    } finally {
      await ops.setSetting(w.db, "telegram.owner_group_id", w.groupId, "test");
    }
  });

  it("takes at most three requests a day: the fourth is refused and no lead is made", async () => {
    for (let i = 0; i < 3; i++) {
      await pickBuild();
      await say("Oʻtkazib yuborish");
      await say("Chilonzor");
      await press("ld:term:week");
    }
    await pickBuild();
    await say("Oʻtkazib yuborish");
    await say("Chilonzor");
    await press("ld:term:week");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe(
      "Bir kunda 3 tadan ortiq ariza qabul qilmaymiz. Ertaga yozing yoki joriy arizalarga javob kuting.",
    );
    expect(
      await q(
        "select 1 from sales.leads l join sales.customers c on c.id = l.customer_id where c.telegram_user_id = $1",
        [ali.id],
      ),
    ).toHaveLength(3);
  });

  it("a request without a build (the selection found nothing) carries the choice in the comment only", async () => {
    for (const d of ["m:select", "sel:task:office", "sel:band:6_7m_12m", "sel:scope:pc", "sel:done", "sel:leave"])
      await press(d);
    await say("Oʻtkazib yuborish");
    await say("Sergeli");
    await press("ld:term:month");
    const lead = await leadOf(ali);
    expect(lead.budget_band).toBe("6_7m_12m");
    expect(lead.comment).toContain("Задача: Офис и учёба");
  });

  it("a text in the middle of a button step is not taken as an answer", async () => {
    await press("m:select");
    await say("Chilonzor");
    expect((await sessionOf(ali)).step).toBe("sel_task");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Tugmalardan foydalaning yoki /start ni bosing.");
  });
});
