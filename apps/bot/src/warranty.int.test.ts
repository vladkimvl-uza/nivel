import { formatDate, formatTime } from "@nivel/i18n";
import { parseWarrantyReport } from "@nivel/telegram";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "./testing/fake-telegram.ts";
import { acceptedOrder, customerWithLead, handedOverOrder, type LeadCase } from "./testing/flow.ts";
import { createHarness, type Harness, lastButtons, newPerson } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

// The roads of a whole order are long; a machine busy with other builds needs more than the 30 seconds of the project.
vi.setConfig({ testTimeout: 180_000 });

let w: BotWorld;
let h: Harness;
let ali: Person;
let lead: LeadCase;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
  ali = newPerson("Ali", "ali_uz", "uz");
  h = createHarness(w);
  lead = await customerWithLead(w, h, ali);
});

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
const press = (data: string, who: Person = ali) => h.send(h.tg.press(who, who.id, 8000, data));
const sessionOf = async (p: Person) =>
  (await q("select value from bot.sessions where key = $1", [`private:${p.id}`]))[0]?.value;

describe("«Report a problem» (ARCHITECTURE 7.2 «Гарантия»)", () => {
  it("needs an order that was handed over", async () => {
    h.tg.reset();
    await press("m:warranty");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Kafolat murojaati uchun topshirilgan buyurtma kerak.");
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:warr`);
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Kafolat murojaati uchun topshirilgan buyurtma kerak.");
  });

  it("the card of a handed over order offers the button, and one order goes straight to the description", async () => {
    const o = await handedOverOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:view`);
    expect(lastButtons(h, ali.id)).toEqual([["Muammo haqida xabar berish", `o:${o.number}:warr`]]);
    await press("m:warranty");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe(
      "Muammoni yozing, kerak boʻlsa foto yuboring. Tugagach «Tayyor» tugmasini bosing.",
    );
    expect(lastButtons(h, ali.id)).toEqual([["Tayyor", "w:done"]]);
    expect((await sessionOf(ali)).step).toBe("warranty_text");
  });

  it("collects the words and the photos, then tells the owner in the topic and queues the report with the exact time", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    h.tg.reset();
    const first = h.tg.text(ali, "Kompyuter yoqilmayapti");
    await h.send(first);
    const second = h.tg.privateMessage(ali, {
      photo: [
        { file_id: "w-s", file_unique_id: "u1", width: 5, height: 5 },
        { file_id: "w-big", file_unique_id: "u2", width: 50, height: 50 },
      ],
    });
    await h.send(second);
    expect(h.tg.calls).toHaveLength(0); // no chatter while the description is being collected
    w.clock.set(new Date("2026-10-20T11:42:00+05:00"));
    await press("w:done");
    const topicTexts = h.tg.textsTo(w.groupId, lead.topicId);
    expect(topicTexts).toEqual([`Гарантийное обращение по заказу ${o.number}: 20.10.2026 11:42.`]);
    const copies = h.tg.of("copyMessage").filter((c) => c.payload.chat_id === w.groupId);
    expect(copies.map((c) => c.payload.message_id)).toEqual([first.message?.message_id, second.message?.message_id]);
    expect(copies.every((c) => c.payload.message_thread_id === lead.topicId && c.payload.from_chat_id === ali.id)).toBe(
      true,
    );
    expect(h.tg.textsTo(ali.id)).toEqual([
      `Murojaat qabul qilindi: ${formatDate("2026-10-20", "uz")} ${formatTime(new Date("2026-10-20T11:42:00+05:00"), "uz")}. Usta javob beradi.`,
    ]);
    const jobs = await q(
      "select payload from ops.outbox where kind = 'job' and payload ->> 'job' = 'warranty.report' and payload ->> 'orderId' = $1",
      [o.orderId],
    );
    expect(jobs).toHaveLength(1);
    expect(parseWarrantyReport(jobs[0].payload)).toEqual({
      job: "warranty.report",
      orderId: o.orderId,
      orderNumber: o.number,
      reportedAt: new Date("2026-10-20T11:42:00+05:00").toISOString(),
      text: "Kompyuter yoqilmayapti",
      photoFileIds: ["w-big"],
      byTelegramId: ali.id,
    });
    expect(
      await q("select 1 from ops.audit_log where action = 'warranty.reported' and entity_id = $1", [o.orderId]),
    ).toHaveLength(1);
    expect((await sessionOf(ali)).step).toBe("idle");
  });

  it("«Done» with nothing written asks to describe the problem first", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    h.tg.reset();
    await press("w:done");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Avval muammoni yozing.");
    expect((await sessionOf(ali)).step).toBe("warranty_text");
  });

  it("a voice message alone is no report the worker could open: the customer is asked for words or a photo", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    await h.send(h.tg.privateMessage(ali, { voice: { file_id: "v1", file_unique_id: "vu", duration: 3 } }));
    h.tg.reset();
    await press("w:done");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Avval muammoni yozing.");
    expect(
      await q("select 1 from ops.outbox where payload ->> 'job' = 'warranty.report' and payload ->> 'orderId' = $1", [
        o.orderId,
      ]),
    ).toHaveLength(0);
    // A voice message with the words is copied to the owner together with them.
    await h.send(h.tg.text(ali, "Ovoz tepada"));
    await press("w:done");
    expect(h.tg.of("copyMessage").filter((c) => c.payload.chat_id === w.groupId)).toHaveLength(2);
  });

  it("the report is queued and written in the audit even when the topic is deleted: the topic is made again", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    await h.send(h.tg.text(ali, "Ekran oʻchib qoldi"));
    h.tg.reset();
    h.tg.failNext("sendMessage", { error_code: 400, description: "Bad Request: message thread not found" });
    await press("w:done");
    const [row] = await q("select tg_topic_id from sales.leads where id = $1", [lead.leadId]);
    expect(Number(row.tg_topic_id)).not.toBe(lead.topicId);
    expect(h.tg.textsTo(w.groupId, Number(row.tg_topic_id)).some((t) => t.includes(o.number))).toBe(true);
    expect(
      await q("select 1 from ops.outbox where payload ->> 'job' = 'warranty.report' and payload ->> 'orderId' = $1", [
        o.orderId,
      ]),
    ).toHaveLength(1);
    expect(h.tg.textsTo(ali.id)[0]).toContain("Murojaat qabul qilindi");
  });

  it("a refusal of the group does not undo the report: it is queued first, the customer is told it was received", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    await h.send(h.tg.text(ali, "Shovqin bor"));
    h.tg.reset();
    h.tg.failNext("sendMessage", { error_code: 500, description: "Internal Server Error" });
    await press("w:done");
    expect(
      await q("select 1 from ops.outbox where payload ->> 'job' = 'warranty.report' and payload ->> 'orderId' = $1", [
        o.orderId,
      ]),
    ).toHaveLength(1);
    expect(
      await q("select 1 from ops.audit_log where action = 'warranty.reported' and entity_id = $1", [o.orderId]),
    ).toHaveLength(1);
    expect(h.tg.textsTo(ali.id)[0]).toContain("Murojaat qabul qilindi");
    expect((await sessionOf(ali)).step).toBe("idle");
  });

  it("a card number written in the description does not stop the report: the job carries it masked, the owner sees the words", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    await h.send(h.tg.text(ali, "Karta 8600 1234 5678 9012 bilan toʻladim, ishlamayapti"));
    h.tg.reset();
    await press("w:done");
    const jobs = await q(
      "select payload from ops.outbox where payload ->> 'job' = 'warranty.report' and payload ->> 'orderId' = $1",
      [o.orderId],
    );
    expect(jobs).toHaveLength(1);
    expect(parseWarrantyReport(jobs[0].payload)?.text).toBe("Karta [...] bilan toʻladim, ishlamayapti");
    expect(h.tg.textsTo(ali.id)[0]).toContain("Murojaat qabul qilindi");
  });

  it("«Done» out of its step does nothing but say the button is old", async () => {
    h.tg.reset();
    await press("w:done");
    expect(h.tg.of("answerCallbackQuery").at(-1)?.payload.text).toBe("Tugma eskirgan: /start ni bosing.");
  });

  it("the order of another customer cannot be reported on", async () => {
    const o = await handedOverOrder(w, lead);
    const bob = newPerson("Bob", "bob", "uz");
    await customerWithLead(w, h, bob);
    h.tg.reset();
    await press(`o:${o.number}:warr`, bob);
    expect(h.tg.textsTo(bob.id)).toEqual(["Buyurtma topilmadi."]);
  });

  it("a long description is cut at 2000 characters, not lost", async () => {
    const o = await handedOverOrder(w, lead);
    await press(`o:${o.number}:warr`);
    await h.send(h.tg.text(ali, "a".repeat(1990)));
    await h.send(h.tg.text(ali, "b".repeat(100)));
    await press("w:done");
    const job = (
      await q(
        "select payload from ops.outbox where payload ->> 'job' = 'warranty.report' and payload ->> 'orderId' = $1",
        [o.orderId],
      )
    )[0];
    expect(parseWarrantyReport(job.payload)?.text).toHaveLength(2000);
  });
});
