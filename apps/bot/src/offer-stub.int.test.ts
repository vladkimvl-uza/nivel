// Acceptance with an offer that is only a stub (DECISIONS R-25, ARCHITECTURE 7.2): the estimate goes out with the plate
// «not an offer» and the button of acceptance is not there, with the words «acceptance after the publication of the offer».
import { orders } from "@nivel/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "./testing/fake-telegram.ts";
import { customerWithLead, type LeadCase, sentOrder } from "./testing/flow.ts";
import { createHarness, type Harness, lastButtons, newPerson } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

// The roads of a whole order are long; a machine busy with other builds needs more than the 30 seconds of the project.
vi.setConfig({ testTimeout: 180_000 });

let w: BotWorld;
let h: Harness;
let ali: Person;
let lead: LeadCase;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true, offers: "stub" });
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
const press = (data: string, who: Person = ali) => h.send(h.tg.press(who, who.id, 4000, data));

describe("the offer is a stub (production mode)", () => {
  it("the card has no button of acceptance, says why, and carries the plate", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:view`);
    const text = String(h.tg.lastSend(ali.id)?.payload.text);
    expect(text).toContain("Qabul qilish oferta eʼlon qilingandan keyin ochiladi.");
    expect(text).toContain("Smeta oferta emas: oferta hali eʼlon qilinmagan.");
    expect(lastButtons(h, ali.id)).toEqual([]);
  });

  it("the same in Russian", async () => {
    const dilya = newPerson("Dilya", "dilya", "ru");
    const l = await customerWithLead(w, h, dilya);
    const o = await sentOrder(w, l);
    h.tg.reset();
    await h.send(h.tg.press(dilya, dilya.id, 4000, `o:${o.number}:view`));
    const text = String(h.tg.lastSend(dilya.id)?.payload.text);
    expect(text).toContain("Акцепт после публикации оферты.");
    expect(text).toContain("Смета не оферта: оферта ещё не опубликована.");
    expect(lastButtons(h, dilya.id)).toEqual([]);
  });

  it("a button made by hand does not accept either: the answer says the offer is not published and nothing is recorded", async () => {
    const o = await sentOrder(w, lead);
    await press(`o:${o.number}:acc:1`);
    await press(`o:${o.number}:acc2:1`);
    expect(h.tg.textsTo(ali.id)).toEqual([
      "Oferta hali eʼlon qilinmagan: qabul qilish keyinroq ochiladi.",
      "Oferta hali eʼlon qilinmagan: qabul qilish keyinroq ochiladi.",
    ]);
    expect((await q("select status from sales.orders where id = $1", [o.orderId]))[0].status).toBe("estimate_sent");
    expect(await q("select 1 from ops.consents where order_id = $1", [o.orderId])).toHaveLength(0);
  });
});

describe("the development mode lets the stub through to try the flow", () => {
  it("shows the button and accepts", async () => {
    const dev = orders.createRuntime({ db: w.bot.db, role: "bot", appMode: "development", now: w.clock.now });
    const dh = createHarness(w, { appMode: "development", rt: dev });
    const bob = newPerson("Bob", "bob", "uz");
    const l = await customerWithLead(w, dh, bob);
    const o = await sentOrder(w, l);
    dh.tg.reset();
    await dh.send(dh.tg.press(bob, bob.id, 4000, `o:${o.number}:view`));
    expect(lastButtons(dh, bob.id)).toEqual([["Oferta va smetani qabul qilaman", `o:${o.number}:acc:1`]]);
    await dh.send(dh.tg.press(bob, bob.id, 4000, `o:${o.number}:acc:1`));
    await dh.send(dh.tg.press(bob, bob.id, 4000, `o:${o.number}:acc2:1`));
    expect((await q("select status from sales.orders where id = $1", [o.orderId]))[0].status).toBe("accepted");
  });
});
