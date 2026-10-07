// «Muammo haqida xabar berish / Сообщить о проблеме» (ARCHITECTURE 7.2 «Гарантия»): the customer describes the problem and
// sends photos; when he presses «Done» the words and the photos are copied into the topic of the order and the report is
// queued with the exact time of the press. The bot may not write `sales.warranty_cases`, so the worker or the admin panel
// opens the case from the report; the term of the warranty counts from this time.
import { ops } from "@nivel/db/repos";
import { formatDate, formatTime } from "@nivel/i18n";
import { orders, outbox } from "@nivel/services";
import {
  BOT_JOB,
  botTranslator,
  decodeCallback,
  encodeCallback,
  MAX_WARRANTY_PHOTOS,
  MAX_WARRANTY_TEXT,
  orderCallback,
  type WarrantyReportPayload,
} from "@nivel/telegram";
import { Composer } from "grammy";
import { ownerGroupId } from "../config.ts";
import type { BotContext } from "../context.ts";
import { advance } from "../steps.ts";
import { orderTopic } from "../store.ts";
import { ack, button, say } from "../ui.ts";
import { loadProfile } from "./profile.ts";

/** The most messages of one report that are copied to the owner's topic. */
const MAX_MESSAGES = 20;
const HANDED_OVER = new Set(["handed_over", "closed"]);

const whenText = (at: Date, lang: "uz" | "ru") => `${formatDate(at, lang)} ${formatTime(at, lang)}`;

async function handedOver(ctx: BotContext) {
  const { customer } = await loadProfile(ctx);
  if (customer === null) return [];
  const all = await orders.listCustomerOrders({ customerId: customer.id }, ctx.deps.rt);
  return all.filter((o) => HANDED_OVER.has(o.status));
}

async function begin(ctx: BotContext, number: string) {
  ctx.session.step = "warranty_text";
  ctx.session.draft.orderNumber = number;
  ctx.session.draft.warrantyParts = { text: "", photoFileIds: [], messageIds: [] };
  return say(ctx, ctx.t("warranty.describe"), [[button(ctx.t("warranty.done_button"), encodeCallback("w", ["done"]))]]);
}

export const warranty = new Composer<BotContext>();

warranty.callbackQuery("m:warranty", async (ctx) => {
  await ack(ctx);
  const list = await handedOver(ctx);
  if (list.length === 0) return say(ctx, ctx.t("warranty.no_orders"));
  const [only] = list;
  if (list.length === 1 && only !== undefined) return begin(ctx, only.number);
  ctx.session.step = "warranty_pick";
  return say(
    ctx,
    ctx.t("warranty.pick_order"),
    list.slice(0, 5).map((o) => [button(o.number, orderCallback(o.number, "warr"))]),
  );
});

warranty.callbackQuery(/^o:[A-Za-z0-9-]+:warr$/, async (ctx) => {
  await ack(ctx);
  const number = decodeCallback(ctx.callbackQuery.data)?.args[0] as string;
  const own = (await handedOver(ctx)).find((o) => o.number === number);
  if (own !== undefined) return begin(ctx, own.number);
  // A number that is not his, or an order that is not handed over: the same answer for both.
  const { customer } = await loadProfile(ctx);
  const known =
    customer !== null &&
    (await orders.listCustomerOrders({ customerId: customer.id }, ctx.deps.rt)).some((o) => o.number === number);
  return say(ctx, ctx.t(known ? "warranty.no_orders" : "my.not_found"));
});

warranty.on("message", async (ctx, next) => {
  const parts = ctx.session.draft.warrantyParts;
  const isCommand = ctx.message.entities?.some((e) => e.type === "bot_command" && e.offset === 0) === true;
  if (ctx.session.step !== "warranty_text" || parts === undefined || isCommand) return next();
  const words = ctx.message.text ?? ctx.message.caption;
  if (words !== undefined)
    parts.text = [parts.text, words]
      .filter((x) => x !== "")
      .join("\n")
      .slice(0, MAX_WARRANTY_TEXT);
  const best = ctx.message.photo?.at(-1);
  if (best !== undefined && parts.photoFileIds.length < MAX_WARRANTY_PHOTOS) parts.photoFileIds.push(best.file_id);
  if (parts.messageIds.length < MAX_MESSAGES) parts.messageIds.push(ctx.message.message_id);
});

warranty.callbackQuery("w:done", async (ctx) => {
  const parts = ctx.session.draft.warrantyParts;
  if (advance(ctx.session.step, "warranty_done") === null || parts === undefined) {
    return ack(ctx, ctx.t("common.stale"));
  }
  await ack(ctx);
  if (parts.text.trim() === "" && parts.messageIds.length === 0) return say(ctx, ctx.t("warranty.empty"));
  const own = (await handedOver(ctx)).find((o) => o.number === ctx.session.draft.orderNumber);
  const { customer } = await loadProfile(ctx);
  if (own === undefined || customer === null) return say(ctx, ctx.t("warranty.no_orders"));
  const at = ctx.deps.now();
  const { db } = ctx.deps;

  // The owner sees the words and the photos in the topic of the order at once.
  const order = await db.query.orders.findFirst({
    columns: { tgTopicId: true, leadId: true },
    where: (t, { eq }) => eq(t.id, own.orderId),
  });
  const thread = order === undefined ? null : await orderTopic(db, order);
  const groupId = await ownerGroupId(db);
  if (thread !== null && groupId !== null) {
    await ctx.api.sendMessage(groupId, `${ownerHeader(at, own.number)}`, { message_thread_id: thread });
    for (const id of parts.messageIds) {
      await ctx.api.copyMessage(groupId, ctx.chat?.id ?? ctx.from.id, id, { message_thread_id: thread });
    }
  } else {
    ctx.deps.log.warn(
      { number: own.number },
      "the report of a problem has no topic to go to; the job still carries it",
    );
  }

  const payload: WarrantyReportPayload = {
    job: BOT_JOB.WARRANTY_REPORT,
    orderId: own.orderId,
    orderNumber: own.number,
    reportedAt: at.toISOString(),
    text: parts.text,
    photoFileIds: parts.photoFileIds,
    byTelegramId: ctx.from.id,
  };
  await outbox.enqueue(
    {
      kind: "job",
      payload: { ...payload },
      dedupeKey: `warranty:${own.orderId}:${parts.messageIds[0] ?? at.getTime()}`,
    },
    {},
    ctx.deps.rt,
  );
  await ops.appendAudit(db, {
    actor: `customer:${customer.id}`,
    action: "warranty.reported",
    entity: "sales.orders",
    entityId: own.orderId,
    after: { reportedAt: payload.reportedAt, messages: parts.messageIds.length, photos: parts.photoFileIds.length },
  });
  ctx.session.step = "idle";
  delete ctx.session.draft.orderNumber;
  delete ctx.session.draft.warrantyParts;
  return say(ctx, ctx.t("warranty.received", { time: whenText(at, ctx.lang) }));
});

/** The header in the owner's topic: Russian, the time of the press. */
function ownerHeader(at: Date, number: string): string {
  return botTranslator("ru")("warranty.owner_card", {
    number,
    time: `${formatDate(at, "ru")} ${formatTime(at, "ru")}`,
  });
}
