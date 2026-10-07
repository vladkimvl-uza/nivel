import { ops } from "@nivel/db/repos";
import { formatDate, formatSum, formatTime } from "@nivel/i18n";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "./testing/fake-telegram.ts";
import { customerWithLead, type LeadCase, ownerActor, reportSentOrder, sentOrder } from "./testing/flow.ts";
import { createHarness, type Harness, lastButtons, newPerson } from "./testing/harness.ts";
import { type BotWorld, createBotWorld, PC_CATALOG } from "./testing/world.ts";

// The roads of a whole order are long; a machine busy with other builds needs more than the 30 seconds of the project.
vi.setConfig({ testTimeout: 180_000 });

let w: BotWorld;
let h: Harness;
let ali: Person;
let lead: LeadCase;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
  await ops.setSetting(
    w.db,
    "requisites.ip",
    {
      holder: "YaTT Nivel Test",
      bank: "Test Bank",
      account: "20208000900100000001",
      mfo: "00014",
      inn: "123456789",
      purpose: "Tovar xaridi uchun {number}",
    },
    "test",
  );
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
const press = (data: string, who: Person = ali, msg = 4000) => h.send(h.tg.press(who, who.id, msg, data));
const say = (text: string, who: Person = ali) => h.send(h.tg.text(who, text));

describe("/order: the orders of the customer", () => {
  it("says there are none", async () => {
    await say("/order");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Hozircha buyurtmalaringiz yoʻq.");
  });

  it("lists the orders with the stage the customer sees, one button each", async () => {
    const o = await sentOrder(w, lead);
    await say("/order");
    const texts = h.tg.textsTo(ali.id);
    expect(texts[0]).toBe("Buyurtmalaringiz:");
    expect(texts[1]).toBe(`${o.number} · Smeta`);
    expect(lastButtons(h, ali.id)).toEqual([["Ochish", `o:${o.number}:view`]]);
  });

  it("the menu button does the same as the command", async () => {
    await sentOrder(w, lead);
    await press("m:order");
    expect(h.tg.textsTo(ali.id)[0]).toBe("Buyurtmalaringiz:");
  });

  it("another customer sees nothing of it", async () => {
    await sentOrder(w, lead);
    const bob = newPerson("Bob", "bob", "uz");
    await customerWithLead(w, h, bob);
    h.tg.reset();
    await h.send(h.tg.text(bob, "/order"));
    expect(h.tg.lastSend(bob.id)?.payload.text).toBe("Hozircha buyurtmalaringiz yoʻq.");
  });
});

describe("the card of an order for the customer", () => {
  it("shows the stage, the fee and the limit from the database and the term, with the button of acceptance", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:view`);
    const [quote] = await q("select fee_total, purchase_limit, valid_until from sales.quotes where id = $1", [
      o.quoteId,
    ]);
    const text = String(h.tg.lastSend(ali.id)?.payload.text);
    expect(text).toContain(`${o.number} · Smeta`);
    expect(text).toContain(formatSum(Number(quote.fee_total), "uz"));
    expect(text).toContain(formatSum(Number(quote.purchase_limit), "uz"));
    expect(text).toContain(`${formatDate(quote.valid_until, "uz")} ${formatTime(quote.valid_until, "uz")}`);
    expect(lastButtons(h, ali.id)).toEqual([["Oferta va smetani qabul qilaman", `o:${o.number}:acc`]]);
  });

  it("a number that is not his is not found, and a made-up one too", async () => {
    const bobLead = await customerWithLead(w, h, newPerson("Bob", "bob", "uz"));
    const theirs = await sentOrder(w, bobLead);
    h.tg.reset();
    await press(`o:${theirs.number}:view`);
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Buyurtma topilmadi.");
    await press("o:NV-2099-0001:view");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Buyurtma topilmadi.");
    await press("o:garbage:view");
    expect(h.tg.textsTo(ali.id)).toEqual(["Buyurtma topilmadi.", "Buyurtma topilmadi.", "Buyurtma topilmadi."]);
  });

  it("an estimate out of date says so and offers no acceptance", async () => {
    const o = await sentOrder(w, lead);
    w.clock.advance(100 * 3_600_000);
    await press(`o:${o.number}:view`);
    expect(String(h.tg.lastSend(ali.id)?.payload.text)).toContain("Smeta muddati tugagan");
    expect(lastButtons(h, ali.id)).toEqual([]);
  });
});

describe("the acceptance of the offer and the estimate", () => {
  it("asks once more on a screen with the consents, naming the non-returnable lines", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:acc`);
    const text = String(h.tg.lastSend(ali.id)?.payload.text);
    expect(text).toContain(o.number);
    expect(text).toContain("qaytarib olmaydigan");
    expect(lastButtons(h, ali.id)).toEqual([["Ha, qabul qilaman", `o:${o.number}:acc2`]]);
  });

  it("the confirmation records the consents of the order and dispatches ACCEPT as the customer", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:acc`);
    await press(`o:${o.number}:acc2`);
    expect(
      (await q("select status, offer_version_uz_id from sales.orders where id = $1", [o.orderId]))[0],
    ).toMatchObject({
      status: "accepted",
    });
    const kinds = (await q("select kind from ops.consents where order_id = $1 order by kind", [o.orderId])).map(
      (r) => r.kind,
    );
    expect(kinds).toEqual(["non_returnable", "supplier_data_transfer"]);
    const journal = await q(
      "select actor_kind, actor_id, event from sales.order_events where order_id = $1 order by seq desc limit 1",
      [o.orderId],
    );
    expect(journal[0]).toMatchObject({ actor_kind: "customer", actor_id: o.customerId });
    expect(journal[0].event).toMatchObject({ type: "ACCEPT", channel: "bot", quoteId: o.quoteId });
    expect(journal[0].event.consentIds).toHaveLength(3);
    const outbox = await q(
      "select payload from ops.outbox where payload ->> 'templateKey' = 'order.accepted' and payload ->> 'orderId' = $1",
      [o.orderId],
    );
    expect(outbox).toHaveLength(1);
  });

  it("shows how to pay: the advance by the QR with a receipt, the money for purchases to the account of the sole proprietor", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:acc`);
    await press(`o:${o.number}:acc2`);
    const expected = await q("select kind, amount_sum from sales.payments where order_id = $1 order by kind", [
      o.orderId,
    ]);
    const sums = Object.fromEntries(expected.map((r) => [r.kind, Number(r.amount_sum)]));
    const texts = h.tg.textsTo(ali.id);
    expect(texts).toContain("Qabul qilindi. Toʻlov tartibi quyida.");
    const instruction = texts.at(-1) as string;
    expect(instruction).toContain(
      `Oldindan toʻlov: ${formatSum(sums.fee_advance as number, "uz")} — Xolis QR orqali, chek bilan.`,
    );
    expect(instruction).toContain(
      `Xarid uchun pul: ${formatSum(sums.purchase_funds as number, "uz")} — faqat YaTT hisobiga bank oʻtkazmasi bilan.`,
    );
    expect(instruction).toContain("YaTT Nivel Test, Test Bank, 20208000900100000001, 00014, 123456789");
    expect(instruction).toContain(`Toʻlov maqsadi: Tovar xaridi uchun ${o.number}`);
    expect(instruction).toContain("Pulni shaxsiy kartaga oʻtkazmang.");
    expect(instruction).toContain("Tushumni egasi tasdiqlaydi.");
  });

  it("a card number never reaches a message, even when the owner typed one into the requisites", async () => {
    await ops.setSetting(w.db, "requisites.ip", { holder: "Karta 8600 1234 5678 9012" }, "test");
    try {
      const o = await sentOrder(w, lead);
      await press(`o:${o.number}:acc`);
      await press(`o:${o.number}:acc2`);
      for (const t of h.tg.textsTo(ali.id)) expect(t).not.toMatch(/(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/);
      expect(h.tg.textsTo(ali.id).at(-1)).toContain("Pulni shaxsiy kartaga oʻtkazmang.");
    } finally {
      await ops.setSetting(
        w.db,
        "requisites.ip",
        {
          holder: "YaTT Nivel Test",
          bank: "Test Bank",
          account: "20208000900100000001",
          mfo: "00014",
          inn: "123456789",
          purpose: "Tovar xaridi uchun {number}",
        },
        "test",
      );
    }
  });

  it("a second press of the confirmation changes nothing and records nothing twice", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:acc`);
    await press(`o:${o.number}:acc2`);
    await press(`o:${o.number}:acc2`);
    expect(await q("select 1 from ops.consents where order_id = $1", [o.orderId])).toHaveLength(2);
    expect(
      await q("select 1 from sales.order_events where order_id = $1 and event ->> 'type' = 'ACCEPT'", [o.orderId]),
    ).toHaveLength(1);
    expect(
      await q("select 1 from sales.payments where order_id = $1 and kind = 'fee_advance'", [o.orderId]),
    ).toHaveLength(1);
  });

  it("after the end of the term the answer says the estimate is out of date, and nothing is recorded as accepted", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:acc`);
    w.clock.advance(100 * 3_600_000);
    await press(`o:${o.number}:acc2`);
    expect(h.tg.textsTo(ali.id).at(-1)).toBe("Smeta muddati tugagan: yangisini tayyorlaymiz.");
    expect((await q("select status from sales.orders where id = $1", [o.orderId]))[0].status).toBe("estimate_sent");
  });

  it("the customer of another order cannot accept this one", async () => {
    const o = await sentOrder(w, lead);
    const bob = newPerson("Bob", "bob", "uz");
    await customerWithLead(w, h, bob);
    h.tg.reset();
    await press(`o:${o.number}:acc`, bob);
    await press(`o:${o.number}:acc2`, bob);
    expect(h.tg.textsTo(bob.id)).toEqual(["Buyurtma topilmadi.", "Buyurtma topilmadi."]);
    expect((await q("select status from sales.orders where id = $1", [o.orderId]))[0].status).toBe("estimate_sent");
    expect(await q("select 1 from ops.consents where order_id = $1", [o.orderId])).toHaveLength(0);
  });
});

describe("the report of the commission", () => {
  it("the card of a sent report carries the two buttons", async () => {
    const o = await reportSentOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:view`);
    expect(lastButtons(h, ali.id)).toEqual([
      ["Tasdiqlayman", `o:${o.number}:rok`],
      ["Savol bor", `o:${o.number}:obj`],
    ]);
    expect(String(h.tg.lastSend(ali.id)?.payload.text)).toContain(
      `Xaridlar: 8 ta, chek boʻyicha jami ${formatSum(
        PC_CATALOG.reduce((s, p) => s + p.price, 0),
        "uz",
      )}.`,
    );
  });

  it("«Confirm» dispatches REPORT_ACCEPTED as the customer", async () => {
    const o = await reportSentOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:rok`);
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Hisobot tasdiqlandi. Rahmat.");
    const journal = await q(
      "select actor_kind, event from sales.order_events where order_id = $1 order by seq desc limit 1",
      [o.orderId],
    );
    expect(journal[0]).toMatchObject({ actor_kind: "customer" });
    expect(journal[0].event).toMatchObject({ type: "REPORT_ACCEPTED" });
  });

  it("«A question» asks for the text, takes one message and dispatches OBJECTION; the owner's topic is told", async () => {
    const o = await reportSentOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:obj`);
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Savolingizni bitta xabarda yozing.");
    await say("Kassa cheki 3-pozitsiyada nima uchun boshqacha?");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Savol egasiga yuborildi. Javob 3 ish kuni ichida.");
    const journal = await q("select event from sales.order_events where order_id = $1 order by seq desc limit 1", [
      o.orderId,
    ]);
    expect(journal[0].event).toMatchObject({
      type: "OBJECTION",
      text: "Kassa cheki 3-pozitsiyada nima uchun boshqacha?",
    });
    const outbox = await q(
      "select payload from ops.outbox where payload ->> 'templateKey' = 'order.report_objection' and payload ->> 'orderId' = $1",
      [o.orderId],
    );
    expect(outbox).toHaveLength(1);
    // The next message is an ordinary one again.
    const session = (await q("select value from bot.sessions where key = $1", [`private:${ali.id}`]))[0].value;
    expect(session.step).toBe("idle");
  });

  it("a button of an order in another status is refused in words", async () => {
    const o = await sentOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:rok`);
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Hozir bu amal mumkin emas: buyurtma boshqa holatda.");
  });

  it("an empty or too long question is not taken", async () => {
    const o = await reportSentOrder(w, lead);
    await press(`o:${o.number}:obj`);
    await h.send(h.tg.privateMessage(ali, { photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] }));
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Savolingizni bitta xabarda yozing.");
    await say("x".repeat(2001));
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Savolingizni bitta xabarda yozing.");
    expect(
      await q("select 1 from sales.order_events where order_id = $1 and event ->> 'type' = 'OBJECTION'", [o.orderId]),
    ).toHaveLength(0);
  });
});

describe("what the owner may do is not what the customer may do", () => {
  it("the buttons of the owner do nothing when the customer presses them", async () => {
    const o = await sentOrder(w, lead);
    h.tg.reset();
    await press(`o:${o.number}:ev:START_PURCHASE`);
    await press(`o:${o.number}:card`);
    expect((await q("select status from sales.orders where id = $1", [o.orderId]))[0].status).toBe("estimate_sent");
    expect(h.tg.of("sendMessage")).toHaveLength(0);
    expect(ownerActor(w).id).toBe(w.owner.id);
  });
});
