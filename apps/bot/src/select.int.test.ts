import { formatSum } from "@nivel/i18n";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineButtons, type Person } from "./testing/fake-telegram.ts";
import { createHarness, type Harness, lastButtons, newPerson, onboard } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

// The roads of a whole order are long; a machine busy with other builds needs more than the 30 seconds of the project.
vi.setConfig({ testTimeout: 180_000 });

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

const press = (data: string, message = 2000) => h.send(h.tg.press(ali, ali.id, message, data));
const sessionOf = async (p: Person) =>
  (await w.db.$client.query("select value from bot.sessions where key = $1", [`private:${p.id}`])).rows[0]?.value;

describe("the selection by buttons (ARCHITECTURE 7.2: task, budget, composition, wishes, 1-3 builds)", () => {
  it("opens with the five tasks", async () => {
    await press("m:select");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Kompyuter qaysi vazifa uchun?");
    expect(lastButtons(h, ali.id).map(([, data]) => data)).toEqual([
      "sel:task:gaming",
      "sel:task:streaming",
      "sel:task:design3d",
      "sel:task:programming",
      "sel:task:office",
    ]);
  });

  it("asks the budget in bands of sums, then the composition", async () => {
    await press("m:select");
    await press("sel:task:gaming");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Byudjet qancha?");
    expect(lastButtons(h, ali.id)).toEqual([
      ["6,7 mln soʻmgacha", "sel:band:lt_6_7m"],
      ["6,7–12 mln soʻm", "sel:band:6_7m_12m"],
      ["12–20 mln soʻm", "sel:band:12m_20m"],
      ["20–35 mln soʻm", "sel:band:20m_35m"],
      ["35 mln soʻmdan", "sel:band:gte_35m"],
    ]);
    await press("sel:band:12m_20m");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Nima kerak?");
    expect(lastButtons(h, ali.id).map(([, data]) => data)).toEqual([
      "sel:scope:pc",
      "sel:scope:pc_periph",
      "sel:scope:setup",
    ]);
  });

  it("shows the template of the task and the tier with the price of the day and the mark «not an offer»", async () => {
    await press("m:select");
    await press("sel:task:gaming");
    await press("sel:band:12m_20m");
    await press("sel:scope:pc");
    expect(h.tg.lastSend(ali.id)?.payload.text).toContain("Istaklar");
    await press("sel:done");
    const texts = h.tg.textsTo(ali.id);
    const card = texts.find((t) => t.includes("Oʻyinlar · 2-daraja"));
    expect(card).toBeDefined();
    // The CPU and the GPU come from price classes (the middle price of their positions), the case is a position.
    expect(card).toContain(formatSum(2_800_000 + 3_600_000 + 650_000, "uz"));
    expect(card).toContain("Oʻyinlar uchun muvozanatli tizim.");
    expect(texts.at(-1)).toBe("Bu yoʻnalish, oferta emas: yakuniy narx smetada.");
    expect(h.tg.of("sendMessage").some((c) => JSON.stringify(c.payload).includes("sel:pick:gaming.T2.A"))).toBe(true);
  });

  it("the same in Russian", async () => {
    const dilya = newPerson("Dilya", "dilya", "ru");
    await onboard(h, dilya, "ru");
    const p = (data: string) => h.send(h.tg.press(dilya, dilya.id, 2000, data));
    for (const d of ["m:select", "sel:task:gaming", "sel:band:12m_20m", "sel:scope:pc_periph", "sel:done"]) await p(d);
    const card = h.tg.textsTo(dilya.id).find((t) => t.includes("Игры · уровень 2"));
    expect(card).toContain(formatSum(7_050_000, "ru"));
    expect(h.tg.textsTo(dilya.id).at(-1)).toBe("Это ориентир, не оферта: итоговая цена — в смете.");
  });

  it("wishes are toggled with a mark, kept in the session and read as a style", async () => {
    await press("m:select");
    await press("sel:task:gaming");
    await press("sel:band:12m_20m");
    await press("sel:scope:pc");
    await press("sel:w:quiet");
    await press("sel:w:rgb");
    expect((await sessionOf(ali)).draft.wishes).toEqual(["quiet", "rgb"]);
    const edited = h.tg.of("editMessageReplyMarkup").at(-1);
    const marked = inlineButtons(edited).map((b) => b.text);
    expect(marked).toContain("✓ Sokin");
    expect(marked).toContain("✓ Yoritishli");
    expect(marked).toContain("Ixcham");
    await press("sel:w:quiet");
    expect((await sessionOf(ali)).draft.wishes).toEqual(["rgb"]);
    // Only template A exists: the lighting asks for B, the customer still gets the closest one.
    await press("sel:done");
    expect(h.tg.textsTo(ali.id).some((t) => t.includes("Oʻyinlar · 2-daraja"))).toBe(true);
  });

  it("a budget of another tier finds nothing: the answer offers to leave a request", async () => {
    await press("m:select");
    await press("sel:task:office");
    await press("sel:band:12m_20m");
    await press("sel:scope:pc");
    await press("sel:done");
    expect(h.tg.lastSend(ali.id)?.payload.text).toContain("tayyor variant yoʻq");
    expect(lastButtons(h, ali.id)).toEqual([["Ariza qoldirish", "sel:leave"]]);
  });

  it("a setup has no templates: the bot goes straight to the request and asks the contact", async () => {
    await press("m:select");
    await press("sel:task:design3d");
    await press("sel:band:20m_35m");
    await press("sel:scope:setup");
    const texts = h.tg.textsTo(ali.id);
    expect(texts).toContain("Setap alohida hisoblanadi: ariza qoldiring, usta oʻzi bogʻlanadi.");
    expect(texts.at(-1)).toBe("Aloqa uchun kontaktingizni ulashing (ixtiyoriy).");
    expect((await sessionOf(ali)).step).toBe("req_contact");
  });

  it("a button of an old message does nothing but says it is old", async () => {
    await press("sel:band:12m_20m");
    expect(h.tg.of("answerCallbackQuery").at(-1)?.payload.text).toBe("Tugma eskirgan: /start ni bosing.");
    expect((await sessionOf(ali)).step).toBe("idle");
    expect((await sessionOf(ali)).draft.band).toBeUndefined();
  });

  it("values the bot never wrote are refused without a change", async () => {
    await press("m:select");
    for (const bad of ["sel:task:nonsense", "sel:task", "sel:zzz:gaming", "sel:band:1"]) await press(bad);
    expect((await sessionOf(ali)).step).toBe("sel_task");
    expect((await sessionOf(ali)).draft.task).toBeUndefined();
  });

  it("every button of the selection fits the 64 bytes of callback_data", async () => {
    await press("m:select");
    await press("sel:task:gaming");
    await press("sel:band:12m_20m");
    await press("sel:scope:pc");
    await press("sel:done");
    for (const data of h.tg.allCallbackData()) expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(h.tg.allCallbackData().length).toBeGreaterThan(10);
  });
});
