// Demo data (CLAUDE.md: only with is_demo, never in production): a template marked as demo is not shown in production
// and carries a plate in the other modes; a template whose part has no price says the master names it.
import { orders } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Person } from "./testing/fake-telegram.ts";
import { createHarness, type Harness, lastButtons, newPerson, onboard } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

let w: BotWorld;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true, withTemplate: true, templateDemo: true });
});
afterAll(async () => {
  await w.close();
});

async function selection(h: Harness, who: Person) {
  await onboard(h, who, who.language_code === "ru" ? "ru" : "uz");
  for (const d of ["m:select", "sel:task:gaming", "sel:band:12m_20m", "sel:scope:pc", "sel:done"]) {
    await h.send(h.tg.press(who, who.id, 2000, d));
  }
}

describe("a template that is demo data", () => {
  it("is not shown in production: the answer is that nothing fits", async () => {
    const h = createHarness(w);
    const who = newPerson("Ali", "ali_uz", "uz");
    await selection(h, who);
    expect(h.tg.lastSend(who.id)?.payload.text).toContain("tayyor variant yoʻq");
    expect(lastButtons(h, who.id)).toEqual([["Ariza qoldirish", "sel:leave"]]);
  });

  it("is shown with the plate «demo data» outside production", async () => {
    const dev = orders.createRuntime({ db: w.bot.db, role: "bot", appMode: "development", now: w.clock.now });
    const h = createHarness(w, { appMode: "development", rt: dev });
    const who = newPerson("Dilya", "dilya", "ru");
    await selection(h, who);
    const card = h.tg.textsTo(who.id).find((t) => t.includes("Игры · уровень 2"));
    expect(card).toContain("Демонстрационные данные: состав и цены не настоящие.");
  });
});

describe("a template with a part that has no price", () => {
  it("says the price is named by the master, not a partial sum", async () => {
    // The only priced position of the GPU class loses its price: the class has nothing sure to take a middle from.
    await w.db.$client.query("update pricing.market_prices set confidence = 'low' where product_id = $1", [
      w.products.gpu.id,
    ]);
    const dev = orders.createRuntime({ db: w.bot.db, role: "bot", appMode: "development", now: w.clock.now });
    const h = createHarness(w, { appMode: "development", rt: dev });
    const who = newPerson("Bob", "bob", "uz");
    await selection(h, who);
    const card = h.tg.textsTo(who.id).find((t) => t.includes("Oʻyinlar · 2-daraja"));
    expect(card).toContain("Narx usta tomonidan aniqlanadi.");
    expect(card).not.toContain("Taxminiy narx");
  });
});
