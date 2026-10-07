// What a customer writes outside the steps of a dialog (ARCHITECTURE 7.2: «ответ владельца копируется клиенту», and the
// other way round): the message is copied into the topic of his order or request. Outside the hours of the answers the
// bot says when the owner answers, once in six hours.
import { formatDate, formatTime } from "@nivel/i18n";
import { ownerGroupId, workCalendar } from "../config.ts";
import type { BotContext } from "../context.ts";
import { nextOpening } from "../hours.ts";
import { topicForCustomer } from "../store.ts";
import { say } from "../ui.ts";
import { loadProfile } from "./profile.ts";

const SIX_HOURS_MS = 6 * 3_600_000;

async function autoReply(ctx: BotContext): Promise<void> {
  const now = ctx.deps.now();
  const calendar = await workCalendar(ctx.deps.db);
  if (calendar.isResponseHours(now)) return;
  const last = ctx.session.lastAutoReplyAt === undefined ? undefined : Date.parse(ctx.session.lastAutoReplyAt);
  if (last !== undefined && now.getTime() - last < SIX_HOURS_MS) return;
  const next = nextOpening(calendar, now);
  ctx.session.lastAutoReplyAt = now.toISOString();
  await say(ctx, ctx.t("autoreply.closed", { next: `${formatDate(next, ctx.lang)} ${formatTime(next, ctx.lang)}` }));
}

/** The message of the customer into the topic of his request; false when there is no topic to put it in. */
export async function relayToTopic(ctx: BotContext): Promise<boolean> {
  const message = ctx.message;
  if (message === undefined) return false;
  const { customer } = await loadProfile(ctx);
  if (customer === null) return false;
  const groupId = await ownerGroupId(ctx.deps.db);
  const thread = await topicForCustomer(ctx.deps.db, customer.id);
  if (groupId === null || thread === null) return false;
  await ctx.api.copyMessage(groupId, message.chat.id, message.message_id, { message_thread_id: thread });
  await autoReply(ctx);
  return true;
}
