import { formatTime } from "@nivel/i18n";
import { acts } from "@nivel/services";
import { keyboardMarkup, renderOutboxMessage } from "@nivel/telegram";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Person } from "./testing/fake-telegram.ts";
import { customerWithLead, type LeadCase, ownerActor, type QuotedOrder, settledOrder } from "./testing/flow.ts";
import { ASSISTANT, createHarness, type Harness, newPerson, OWNER, STRANGER } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

let w: BotWorld;
let h: Harness;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true });
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => {
  w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
  h = createHarness(w);
});

interface Case {
  person: Person;
  lead: LeadCase;
  order: QuotedOrder;
  actId: string;
  hex: string;
  /** The id of the message with the button, as Telegram gave it to the relay that sent it. */
  buttonMessage: number;
}

/** A settled order with an act of acceptance of the materials and the message the relay sends for it. */
async function actCase(person: Person): Promise<Case> {
  const lead = await customerWithLead(w, h, person);
  const order = await settledOrder(w, lead);
  const { actId } = await acts.generate(
    {
      orderId: order.orderId,
      kind: "material_acceptance",
      lines: [{ title: "Case Fractal North", qty: 1, serial: "FN-1" }],
    },
    ownerActor(w),
    w.admin,
  );
  const lang = person.language_code === "ru" ? "ru" : "uz";
  // What the relay of the worker does with the message the services queue for an act: the shared template, the id from Telegram.
  const m = renderOutboxMessage({
    target: "customer",
    templateKey: "act.sign_request",
    lang,
    orderNumber: order.number,
    params: { actId, actKind: "material_acceptance" },
  });
  const markup = keyboardMarkup(m.buttons);
  const sent = await h.bot.api.sendMessage(person.id, m.text, markup === undefined ? {} : { reply_markup: markup });
  h.tg.reset();
  return { person, lead, order, actId, hex: actId.replaceAll("-", ""), buttonMessage: sent.message_id };
}

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
const actRow = async (c: Case) =>
  (await q("select signed_at, signed_via, evidence from sales.acts where id = $1", [c.actId]))[0];

describe("the button «I accept» under an act", () => {
  it("signs for the customer of the order: the time of the database, the id of the message and the Telegram id of the person", async () => {
    const c = await actCase(newPerson("Ali", "ali_uz", "uz"));
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage, `a:${c.hex}:sg`));
    const row = await actRow(c);
    expect(row.signed_via).toBe("tg_button");
    expect(row.signed_at).not.toBeNull();
    expect(row.evidence).toEqual({ messageId: c.buttonMessage, telegramUserId: c.person.id });
    expect(h.tg.textsTo(c.person.id)).toEqual([`Imzolandi: ${formatTime(row.signed_at, "uz")}.`]);
    // The button is taken off the message: it cannot be pressed twice.
    expect(h.tg.of("editMessageReplyMarkup")).toHaveLength(1);
  });

  it("answers a Russian customer in Russian", async () => {
    const c = await actCase(newPerson("Dilya", "dilya", "ru"));
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage, `a:${c.hex}:sg`));
    const row = await actRow(c);
    expect(h.tg.textsTo(c.person.id)).toEqual([`Подписано: ${formatTime(row.signed_at, "ru")}.`]);
  });

  it("a second press says it is signed and changes nothing", async () => {
    const c = await actCase(newPerson("Ali", "ali_uz", "uz"));
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage, `a:${c.hex}:sg`));
    const first = await actRow(c);
    h.tg.reset();
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage + 50, `a:${c.hex}:sg`));
    expect(h.tg.textsTo(c.person.id)).toEqual(["Dalolatnoma allaqachon imzolangan."]);
    expect(await actRow(c)).toEqual(first);
  });

  it("another customer cannot sign it, even with the right button", async () => {
    const c = await actCase(newPerson("Ali", "ali_uz", "uz"));
    const bob = newPerson("Bob", "bob", "uz");
    await customerWithLead(w, h, bob);
    h.tg.reset();
    await h.send(h.tg.press(bob, bob.id, c.buttonMessage, `a:${c.hex}:sg`));
    expect(h.tg.textsTo(bob.id)).toEqual(["Bu dalolatnoma sizning buyurtmangizga tegishli emas."]);
    expect((await actRow(c)).signed_at).toBeNull();
  });

  it("an act that does not exist, or a button that is not ours, signs nothing", async () => {
    const c = await actCase(newPerson("Ali", "ali_uz", "uz"));
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage, "a:0190a1b2c3d47e5f8a9b0c1d2e3f4a5b:sg"));
    expect(h.tg.textsTo(c.person.id)).toEqual(["Bu dalolatnoma sizning buyurtmangizga tegishli emas."]);
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage, "a:nothex:sg"));
    await h.send(h.tg.press(c.person, c.person.id, c.buttonMessage, `a:${c.hex}:zz`));
    expect(h.tg.textsTo(c.person.id)).toHaveLength(1);
    expect((await actRow(c)).signed_at).toBeNull();
  });

  it("the owner, the assistant and a stranger cannot press it for the customer", async () => {
    const c = await actCase(newPerson("Ali", "ali_uz", "uz"));
    for (const who of [OWNER, ASSISTANT, STRANGER]) {
      await h.send(h.tg.press(who, w.groupId, 5000, `a:${c.hex}:sg`, c.lead.topicId));
    }
    expect((await actRow(c)).signed_at).toBeNull();
    expect(h.tg.of("sendMessage")).toHaveLength(0);
  });

  it("a press that comes without the message it belongs to (an inline message) proves nothing and signs nothing", async () => {
    const c = await actCase(newPerson("Ali", "ali_uz", "uz"));
    const update = h.tg.press(c.person, c.person.id, c.buttonMessage, `a:${c.hex}:sg`);
    delete (update.callback_query as { message?: unknown }).message;
    await h.send(update);
    expect((await actRow(c)).signed_at).toBeNull();
    // Without the message there is no chat to answer in: the update is dropped before any handler.
    expect(h.tg.of("sendMessage")).toHaveLength(0);
  });
});
