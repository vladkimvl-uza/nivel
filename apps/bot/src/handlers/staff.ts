// The owner's group (ARCHITECTURE 7.1, 7.2 «Группа владельца»): only the owner and the assistant are heard. A reply in a
// topic is copied to the customer (lines that begin with `//` stay in the group). The buttons of an order send events as
// the person who pressed (the database checks his Telegram id against ops.admin_users). The buttons of a request
// (in work, spam, address) and the copying of replies rest on the owner's id and the list of the assistants in the
// settings only: the bot has no right to read ops.admin_users, so a helper switched off in the admin panel is also to
// be taken out of `telegram.assistant_ids`.
import { sales } from "@nivel/db/repos";
import { dispatch, orders } from "@nivel/services";
import { botTranslator, decodeCallback, hexToUuid, keyboardMarkup, stripOwnerNotes } from "@nivel/telegram";
import { Composer, GrammyError } from "grammy";
import { isButtonEvent, orderCard } from "../cards.ts";
import { staffRole } from "../config.ts";
import type { BotContext } from "../context.ts";
import { customerTelegram, getLead, markFirstResponse, orderTopic, topicTarget } from "../store.ts";
import { ack } from "../ui.ts";
import { receipts } from "./receipts.ts";

/** Message kinds that carry something to copy (not the service messages of the forum: a new topic, a pin). */
const CONTENT = [
  "text",
  "photo",
  "video",
  "voice",
  "document",
  "audio",
  "animation",
  "video_note",
  "sticker",
  "location",
  "contact",
] as const;

const threadOf = (ctx: BotContext): number | undefined => {
  const m = ctx.callbackQuery?.message ?? ctx.message;
  return m !== undefined && "message_thread_id" in m ? (m.message_thread_id as number | undefined) : undefined;
};

const inTopic = (ctx: BotContext, text: string, thread: number | undefined) =>
  ctx.reply(text, thread === undefined ? {} : { message_thread_id: thread });

export const staff = new Composer<BotContext>();

// Only the owner and the assistant: a stranger is not answered (a button gets a window that says why).
staff.use(async (ctx, next) => {
  const role = ctx.from === undefined ? null : await staffRole(ctx.deps, ctx.from.id);
  ctx.lang = "ru";
  ctx.t = botTranslator("ru");
  if (role === null) {
    await ack(ctx, ctx.t("owner.unauthorized"), true);
    return;
  }
  ctx.staff = role;
  await next();
});

staff.command("card", async (ctx) => {
  const thread = threadOf(ctx);
  if (thread === undefined) return ctx.reply(ctx.t("owner.card.no_topic"));
  const target = await topicTarget(ctx.deps.db, thread);
  if (target.orderId === null) return inTopic(ctx, ctx.t("owner.card.no_order"), thread);
  const card = await orderCard(ctx, target.orderId, ctx.staff as "owner" | "assistant");
  if (card === null) return inTopic(ctx, ctx.t("owner.card.no_order"), thread);
  const markup = keyboardMarkup(card.rows);
  return ctx.reply(card.text, { message_thread_id: thread, ...(markup === undefined ? {} : { reply_markup: markup }) });
});

// ---- the buttons of a request: in work, spam, address ---------------------------------------------------------
staff.callbackQuery(/^l:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const leadId = hexToUuid(data?.args[0]);
  const action = data?.args[1];
  const thread = threadOf(ctx);
  if (leadId === null || (action !== "wk" && action !== "sp" && action !== "ad")) return ack(ctx);
  const lead = await getLead(ctx.deps.db, leadId);
  // A button works in the topic of its own request only.
  if (lead === null || thread === undefined || lead.tgTopicId !== thread) return ack(ctx, ctx.t("common.stale"));
  await ack(ctx);
  if (action === "ad") {
    const customer = lead.customerId === null ? null : await customerAddress(ctx, lead.customerId);
    return inTopic(
      ctx,
      customer === null ? ctx.t("owner.lead.address_none") : ctx.t("owner.lead.address_value", { address: customer }),
      thread,
    );
  }
  if (lead.status !== "new" && lead.status !== "in_review") return inTopic(ctx, ctx.t("owner.lead.not_open"), thread);
  if (action === "wk") {
    await sales.setLeadStatus(ctx.deps.db, lead.id, "in_review");
    return inTopic(ctx, ctx.t("owner.lead.in_work", { number: lead.number }), thread);
  }
  await sales.setLeadStatus(ctx.deps.db, lead.id, "spam");
  return inTopic(ctx, ctx.t("owner.lead.spam_done", { number: lead.number }), thread);
});

async function customerAddress(ctx: BotContext, customerId: string): Promise<string | null> {
  const { rows } = await ctx.deps.db.$client.query<{ address: string | null }>(
    "select address from sales.customers where id = $1",
    [customerId],
  );
  const address = rows[0]?.address?.trim();
  return address === undefined || address === "" ? null : address;
}

// ---- the buttons of an order: refresh and the events of the automaton ----------------------------------------
async function showCard(ctx: BotContext, orderId: string) {
  const card = await orderCard(ctx, orderId, ctx.staff as "owner" | "assistant");
  if (card === null) return;
  const markup = keyboardMarkup(card.rows);
  const extra = { ...(markup === undefined ? {} : { reply_markup: markup }) };
  if (ctx.callbackQuery?.message === undefined) return ctx.reply(card.text, extra);
  try {
    await ctx.editMessageText(card.text, extra);
  } catch {
    // The text did not change (Telegram refuses an identical edit): nothing to redraw.
  }
}

staff.callbackQuery(/^o:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const [number, action, arg] = data?.args ?? [];
  const thread = threadOf(ctx);
  if (number === undefined || (action !== "card" && action !== "ev") || thread === undefined) return ack(ctx);
  const order = await sales.getOrderByNumber(ctx.deps.db, number);
  // A button works in the topic of its own order only (a made-up number does not reach another customer's order).
  if (order === null || (await orderTopic(ctx.deps.db, order)) !== thread) return ack(ctx, ctx.t("common.stale"));
  const role = ctx.staff as "owner" | "assistant";
  if (action === "card") {
    await ack(ctx);
    return showCard(ctx, order.id);
  }
  if (!isButtonEvent(arg)) return ack(ctx);
  try {
    const result = await dispatch(order.id, { type: arg }, { kind: role, id: String(ctx.from.id) }, ctx.deps.rt);
    if (!result.ok) {
      return ack(ctx, ctx.t("owner.event.refused", { reason: ctx.t(`owner.error.${result.error}`) }), true);
    }
    await ack(
      ctx,
      ctx.t("owner.event.done", { event: ctx.t(`owner.event.${arg}`), status: ctx.t(`owner.status.${result.status}`) }),
    );
    return showCard(ctx, order.id);
  } catch (err) {
    if (
      !(
        err instanceof orders.ForbiddenError ||
        err instanceof orders.NotFoundError ||
        err instanceof orders.ValidationError
      )
    ) {
      throw err;
    }
    ctx.deps.log.warn({ err, number, event: arg }, "an event of the owner was not taken");
    return ack(ctx, ctx.t("owner.error.other"), true);
  }
});

// ---- a message in a topic: a receipt, a paper act, or a reply for the customer -------------------------------
staff.use(receipts);

staff.on("message", async (ctx) => {
  const message = ctx.message;
  const thread = message.message_thread_id;
  // The General topic, commands and service messages of the forum are not for the customer.
  if (thread === undefined || !CONTENT.some((k) => k in message)) return;
  if (message.entities?.some((e) => e.type === "bot_command" && e.offset === 0)) return;
  const target = await topicTarget(ctx.deps.db, thread);
  if (target.customerId === null) return;
  const customer = await customerTelegram(ctx.deps.db, target.customerId);
  if (customer?.telegramUserId == null) return inTopic(ctx, ctx.t("owner.copy.no_customer"), thread);
  const chatId = customer.telegramUserId;

  const text = message.text ?? message.caption;
  const { text: cleaned, hadNotes } = stripOwnerNotes(text);
  let delivered = true;
  try {
    if (message.text !== undefined && hadNotes) {
      if (cleaned === "") delivered = false;
      else await ctx.api.sendMessage(chatId, cleaned);
    } else if (hadNotes) {
      await ctx.api.copyMessage(chatId, ctx.chat.id, message.message_id, { caption: cleaned });
    } else {
      await ctx.api.copyMessage(chatId, ctx.chat.id, message.message_id);
    }
  } catch (err) {
    if (!(err instanceof GrammyError)) throw err;
    ctx.deps.log.warn({ err: err.description, customerId: target.customerId }, "the answer was not delivered");
    return inTopic(ctx, ctx.t("owner.copy.failed"), thread);
  }
  // An internal note that reached nobody is not an answer to the customer.
  if (delivered && target.leadId !== null) await markFirstResponse(ctx.deps.db, target.leadId);
});
