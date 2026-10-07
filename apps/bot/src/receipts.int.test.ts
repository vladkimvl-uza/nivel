import { ops } from "@nivel/db/repos";
import { formatSum } from "@nivel/i18n";
import { acts } from "@nivel/services";
import { parseFileIntake } from "@nivel/telegram";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineButtons, type Person } from "./testing/fake-telegram.ts";
import {
  acceptedOrder,
  customerWithLead,
  type LeadCase,
  ownerActor,
  purchasingOrder,
  type QuotedOrder,
  settledOrder,
} from "./testing/flow.ts";
import { ASSISTANT, createHarness, type Harness, newPerson, OWNER, STRANGER } from "./testing/harness.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

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
  w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
  ali = newPerson("Ali", "ali_uz", "uz");
  h = createHarness(w);
  lead = await customerWithLead(w, h, ali);
  h.tg.reset();
});

const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;
const photo = (id = "AgAC-photo-1") => [
  { file_id: `${id}-s`, file_unique_id: `${id}-su`, width: 90, height: 90 },
  { file_id: id, file_unique_id: `${id}-u`, width: 1280, height: 960 },
];
const inTopic = (who: Person, fields: Record<string, unknown>, topic = lead.topicId) =>
  h.send(h.tg.groupMessage(w.groupId, who, fields, topic));
const press = (who: Person, data: string, topic = lead.topicId, message = 6000) =>
  h.send(h.tg.press(who, w.groupId, message, data, topic));
const jobs = (orderId: string) =>
  q(
    "select payload, dedupe_key from ops.outbox where kind = 'job' and payload ->> 'job' = 'telegram.file_intake' and payload ->> 'orderId' = $1",
    [orderId],
  );
/** The drafts of this topic: the database is shared by the tests of the file. */
const drafts = () =>
  q("select key from bot.sessions where key like 'draft:%' and value ->> 'threadId' = $1", [String(lead.topicId)]);

/** An order whose purchases have started: the receipts come now. */
async function buying(): Promise<QuotedOrder> {
  const o = await purchasingOrder(w, lead);
  h.tg.reset();
  return o;
}

describe("the photo of a receipt in a topic: «1250000 Mycom»", () => {
  it("is not copied to the customer; the bot offers the lines of the quote, the nearest to the sum first", async () => {
    await buying();
    await inTopic(OWNER, { photo: photo(), caption: "1100000 Mycom" });
    expect(h.tg.of("copyMessage")).toHaveLength(0);
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    expect(card?.payload.message_thread_id).toBe(lead.topicId);
    expect(String(card?.payload.text)).toContain(`Чек: ${formatSum(1_100_000, "ru")} · Mycom`);
    expect(String(card?.payload.text)).toContain("Заказ NV-");
    const buttons = inlineButtons(card);
    expect(buttons).toHaveLength(5);
    expect(buttons[0]?.text).toContain("Kingston");
    expect(buttons[0]?.text).toContain(formatSum(1_100_000, "ru"));
    expect(buttons.slice(3).map((b) => b.text)).toEqual(["Вне сметы", "Отмена"]);
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(await drafts()).toHaveLength(1);
  });

  it("a job the queue refuses (a card number in the caption) is not lost in silence: the owner is told to enter it by hand", async () => {
    const o = await buying();
    await inTopic(OWNER, { photo: photo("AgAC-card"), caption: "1100000 8600123456789012" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    h.tg.reset();
    const errors = await press(OWNER, inlineButtons(card)[0]?.callback_data as string);
    expect(errors).toEqual([]);
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual([
      "Черновик не удалось поставить в очередь. Внесите чек в админке вручную.",
    ]);
    expect(await jobs(o.orderId)).toHaveLength(0);
  });

  it("the choice of a line hands the photo and the sum to the worker as a job and says what comes next", async () => {
    const o = await buying();
    await inTopic(OWNER, { photo: photo("AgAC-r1"), caption: "1100000 Mycom" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    const first = inlineButtons(card)[0]?.callback_data as string;
    await press(OWNER, first);
    const queued = await jobs(o.orderId);
    expect(queued).toHaveLength(1);
    const payload = parseFileIntake(queued[0]?.payload);
    expect(payload).toMatchObject({
      kind: "receipt_photo",
      orderNumber: o.number,
      telegramFileId: "AgAC-r1",
      amountSum: 1_100_000,
      vendorName: "Mycom",
      byTelegramId: OWNER.id,
      mime: "image/jpeg",
    });
    const [line] = await q("select id from sales.quote_lines where quote_id = $1 and product_id = $2", [
      o.quoteId,
      w.products.ram.id,
    ]);
    expect(payload?.quoteLineId).toBe(line.id);
    expect(h.tg.textsTo(w.groupId, lead.topicId).at(-1)).toBe(
      `Черновик закупки принят: ${formatSum(1_100_000, "ru")} · Mycom. Внесите его в админке (закупки): клиенту фото уйдёт после записи.`,
    );
    expect(await drafts()).toHaveLength(0);
    // Nothing was written into the purchases: the bot has no right to, the admin panel records it.
    expect(await q("select 1 from sales.purchases where order_id = $1", [o.orderId])).toHaveLength(0);
  });

  it("«Outside the quote» hands it over without a line", async () => {
    const o = await buying();
    await inTopic(OWNER, { photo: photo("AgAC-r2"), caption: "50000 Texnomart" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    const outside = inlineButtons(card).find((b) => b.text === "Вне сметы");
    await press(OWNER, outside?.callback_data as string);
    const payload = parseFileIntake((await jobs(o.orderId))[0]?.payload);
    expect(payload).toMatchObject({ amountSum: 50_000, vendorName: "Texnomart" });
    expect(payload?.quoteLineId).toBeUndefined();
  });

  it("a second press of the same button does not queue the job twice", async () => {
    const o = await buying();
    await inTopic(OWNER, { photo: photo("AgAC-r3"), caption: "1100000 Mycom" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    const first = inlineButtons(card)[0]?.callback_data as string;
    await press(OWNER, first);
    await press(OWNER, first);
    expect(await jobs(o.orderId)).toHaveLength(1);
    expect(h.tg.textsTo(w.groupId, lead.topicId).at(-1)).toBe("Черновик устарел: пришлите чек ещё раз.");
  });

  it("the same photo sent twice is one job", async () => {
    const o = await buying();
    for (let i = 0; i < 2; i++) {
      await inTopic(OWNER, { photo: photo("AgAC-same"), caption: "1100000 Mycom" });
      const card = h.tg
        .of("sendMessage")
        .filter((c) => c.payload.chat_id === w.groupId)
        .at(-1);
      await press(OWNER, inlineButtons(card)[0]?.callback_data as string);
    }
    expect(await jobs(o.orderId)).toHaveLength(1);
  });

  it("«Cancel» queues nothing and forgets the draft", async () => {
    const o = await buying();
    await inTopic(OWNER, { photo: photo("AgAC-r4"), caption: "1100000 Mycom" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    await press(OWNER, inlineButtons(card).at(-1)?.callback_data as string);
    expect(await jobs(o.orderId)).toHaveLength(0);
    expect(await drafts()).toHaveLength(0);
    expect(h.tg.textsTo(w.groupId, lead.topicId).at(-1)).toBe("Отменено.");
  });

  it("warns when the receipt takes the purchases above the limit of the quote", async () => {
    await buying();
    await inTopic(OWNER, { photo: photo("AgAC-big"), caption: "99000000 Mycom" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    expect(String(card?.payload.text)).toContain("Внимание: с этим чеком закупка превысит лимит");
  });

  it("the assistant may bring a receipt: recording a purchase is among his events", async () => {
    const o = await buying();
    await inTopic(ASSISTANT, { photo: photo("AgAC-a1"), caption: "1100000 Mycom" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    await press(ASSISTANT, inlineButtons(card)[0]?.callback_data as string);
    expect(parseFileIntake((await jobs(o.orderId))[0]?.payload)?.byTelegramId).toBe(ASSISTANT.id);
  });

  it("a stranger's photo is not heard", async () => {
    const o = await buying();
    await inTopic(STRANGER, { photo: photo("AgAC-s1"), caption: "1100000 Mycom" });
    expect(h.tg.calls).toHaveLength(0);
    expect(await jobs(o.orderId)).toHaveLength(0);
  });

  it("the button of a draft works in the topic of its order only", async () => {
    const o = await buying();
    await inTopic(OWNER, { photo: photo("AgAC-x1"), caption: "1100000 Mycom" });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    const other = await customerWithLead(w, h, newPerson("Bob", "bob", "uz"));
    await press(OWNER, inlineButtons(card)[0]?.callback_data as string, other.topicId);
    expect(await jobs(o.orderId)).toHaveLength(0);
  });

  it("refuses a receipt while the order is not in the purchase", async () => {
    const o = await acceptedOrder(w, lead);
    h.tg.reset();
    await inTopic(OWNER, { photo: photo("AgAC-w1"), caption: "1100000 Mycom" });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual([
      `Чек принимается в статусе «Закупка»; сейчас ${o.number}: Принято, ждём оплату.`,
    ]);
    expect(await drafts()).toHaveLength(0);
  });

  it("refuses a receipt in a topic that has no order yet", async () => {
    await inTopic(OWNER, { photo: photo("AgAC-n1"), caption: "1100000 Mycom" });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual(["Для этой темы нет заказа."]);
  });

  it("a photo without a caption of this form is an ordinary photo for the customer", async () => {
    await buying();
    await inTopic(OWNER, { photo: photo("AgAC-p1"), caption: "Корпус пришёл" });
    expect(h.tg.of("copyMessage")).toHaveLength(1);
    expect(await drafts()).toHaveLength(0);
  });

  it("takes the file of an ESF (PDF) or a PNG, and asks for a photo instead of a HEIC", async () => {
    const o = await buying();
    await inTopic(OWNER, {
      document: { file_id: "doc-pdf", file_unique_id: "doc-pdf-u", mime_type: "application/pdf", file_name: "esf.pdf" },
      caption: "2800000 Mycom",
    });
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    await press(OWNER, inlineButtons(card).at(-2)?.callback_data as string);
    expect(parseFileIntake((await jobs(o.orderId))[0]?.payload)).toMatchObject({
      mime: "application/pdf",
      telegramFileId: "doc-pdf",
    });
    h.tg.reset();
    await inTopic(OWNER, {
      document: { file_id: "doc-heic", file_unique_id: "doc-heic-u", mime_type: "image/heic", file_name: "IMG_1.HEIC" },
      caption: "2800000 Mycom",
    });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual([
      "Отправьте снимок как фото, а не файлом: HEIC-файл не открывается.",
    ]);
    expect(await drafts()).toHaveLength(0);
  });
});

describe("the photo of a paper act", () => {
  async function settledWithAct() {
    const o = await settledOrder(w, lead);
    const { actId } = await acts.generate(
      { orderId: o.orderId, kind: "material_acceptance", lines: [{ title: "Case", qty: 1 }] },
      ownerActor(w),
      w.admin,
    );
    h.tg.reset();
    return { o, actId };
  }

  it("is handed over for the act of the order, after the owner confirms", async () => {
    const { o, actId } = await settledWithAct();
    await inTopic(OWNER, { photo: photo("AgAC-act1"), caption: "акт" });
    expect(h.tg.of("copyMessage")).toHaveLength(0);
    const card = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    expect(String(card?.payload.text)).toBe(`Фото бумажного акта по заказу ${o.number}: подтвердить?`);
    await press(OWNER, inlineButtons(card)[0]?.callback_data as string);
    const payload = parseFileIntake((await jobs(o.orderId))[0]?.payload);
    expect(payload).toMatchObject({ kind: "act_photo", actId, telegramFileId: "AgAC-act1", byTelegramId: OWNER.id });
    expect(h.tg.textsTo(w.groupId, lead.topicId).at(-1)).toBe(
      "Фото акта принято: внесите подпись в админке (бумажный акт).",
    );
    // The act stays unsigned: only the admin panel records a paper signature.
    expect((await q("select signed_at from sales.acts where id = $1", [actId]))[0].signed_at).toBeNull();
  });

  it("says there is nothing to sign when every act is signed or none is drawn", async () => {
    const o = await settledOrder(w, lead);
    h.tg.reset();
    await inTopic(OWNER, { photo: photo("AgAC-act2"), caption: "Акт" });
    expect(h.tg.textsTo(w.groupId, lead.topicId)).toEqual([`По заказу ${o.number} нет неподписанного акта.`]);
  });
});
