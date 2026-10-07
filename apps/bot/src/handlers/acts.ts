// The button «Qabul qildim / Принял» under an act (ARCHITECTURE 7.2 «Отчёт и акт»): the press is signed by
// `services.acts.sign` → `sales.sign_act`, with the evidence {messageId, telegramUserId}: the message that carries the
// button (it comes with the press) and the person who pressed it. The database signs only for the customer of the
// order of the act, once, with its own clock. The strength of the button as a signature is a question for the lawyer;
// the fallback is the photo of the paper act (the owner records it in the admin panel).
import { formatTime } from "@nivel/i18n";
import { acts, dispatch, orders } from "@nivel/services";
import { decodeCallback, hexToUuid } from "@nivel/telegram";
import { Composer } from "grammy";
import type { BotContext } from "../context.ts";
import { ack, clearButtons, say } from "../ui.ts";
import { loadProfile } from "./profile.ts";

export const actButtons = new Composer<BotContext>();

actButtons.callbackQuery(/^a:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const actId = hexToUuid(data?.args[0]);
  if (actId === null || data?.args[1] !== "sg") return ack(ctx);
  const message = ctx.callbackQuery.message;
  // The evidence names the message that carries the button; a press without one proves nothing.
  if (message === undefined) return ack(ctx, ctx.t("act.error"), true);
  await ack(ctx);
  const { customer } = await loadProfile(ctx);
  if (customer === null) return say(ctx, ctx.t("act.not_yours"));
  try {
    await acts.sign(
      { actId, via: "tg_button", evidence: { messageId: message.message_id, telegramUserId: ctx.from.id } },
      { kind: "customer", id: customer.id },
      ctx.deps.rt,
    );
  } catch (err) {
    if (err instanceof orders.NotFoundError) return say(ctx, ctx.t("act.not_yours"));
    if (err instanceof orders.ValidationError) {
      const code = err.issues[0]?.code;
      if (code === "act_already_signed") {
        await clearButtons(ctx);
        return say(ctx, ctx.t("act.already"));
      }
      if (code === "evidence_mismatch") return say(ctx, ctx.t("act.not_yours"));
    }
    ctx.deps.log.error({ err, actId }, "the act was not signed");
    return say(ctx, ctx.t("act.error"));
  }
  await clearButtons(ctx);
  await handOverIfDue(ctx, actId, customer.id);
  // The time is the one the database wrote, not the clock of this process.
  const row = await ctx.deps.db.query.acts.findFirst({
    columns: { signedAt: true },
    where: (t, { eq }) => eq(t.id, actId),
  });
  return say(ctx, ctx.t("act.signed", { time: formatTime(row?.signedAt ?? ctx.deps.now(), ctx.lang) }));
});

/**
 * The press under the act of handover is also the button of the customer in the table of the automaton («HANDOVER: owner
 * (+ the button of the customer)»): the order is handed over when the final part of the fee is confirmed. Before that the
 * act is only signed, and the owner hands the order over in the admin panel once the money is confirmed.
 */
async function handOverIfDue(ctx: BotContext, actId: string, customerId: string): Promise<void> {
  const { db, rt } = ctx.deps;
  const act = await db.query.acts.findFirst({
    columns: { kind: true, orderId: true },
    where: (t, { eq }) => eq(t.id, actId),
  });
  if (act?.kind !== "handover") return;
  const final = await db.query.payments.findFirst({
    columns: { id: true },
    where: (t, { and, eq, isNull }) =>
      and(eq(t.orderId, act.orderId), eq(t.kind, "fee_final"), eq(t.status, "confirmed"), isNull(t.reversalOf)),
  });
  if (final === undefined) return;
  const result = await dispatch(
    act.orderId,
    { type: "HANDOVER", actId, finalPaymentId: final.id },
    { kind: "customer", id: customerId },
    rt,
  );
  if (!result.ok) ctx.deps.log.warn({ actId, error: result.error }, "the handover was not taken after the signature");
}
