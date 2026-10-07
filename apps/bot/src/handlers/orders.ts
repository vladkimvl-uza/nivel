// The orders of the customer (ARCHITECTURE 7.2 «Смета и акцепт», «Оплата», «Отчёт и акт»): the list, the card, the
// acceptance of the offer and the estimate, the instruction to pay, the confirmation of the report and the question to
// it. The customer sees only his own orders (the customer views of the database, the id of the customer from the
// checked Telegram id); every sum on the screen comes from the database, never from the button.
import { content } from "@nivel/db/repos";
import { formatDate, formatTime } from "@nivel/i18n";
import { consents, dispatch, orders, reports } from "@nivel/services";
import type { InlineButton } from "@nivel/telegram";
import { decodeCallback, orderCallback, sumText } from "@nivel/telegram";
import { Composer } from "grammy";
import { paymentRequisites } from "../config.ts";
import type { BotContext } from "../context.ts";
import { latestConsent, offersPublished } from "../store.ts";
import { ack, button, clearButtons, say } from "../ui.ts";
import { loadProfile } from "./profile.ts";

const MAX_QUESTION = 2000;
/** Sixteen digits in a row: a card number. The requisites the owner typed are not shown if they look like one. */
const CARD_NUMBER = /(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/;
const SHOWN_REFUSALS = new Set(["estimate_expired", "offer_not_published", "consent_missing", "invalid_transition"]);

type View = Awaited<ReturnType<typeof orders.getCustomerOrder>>;

const refusal = (ctx: BotContext, code: string) =>
  ctx.t(SHOWN_REFUSALS.has(code) ? `my.error.${code}` : "my.error.other");

const when = (ctx: BotContext, at: Date) => `${formatDate(at, ctx.lang)} ${formatTime(at, ctx.lang)}`;

/** The order of this customer by its number, or null (the answer is the same for an order of somebody else). */
async function orderOf(
  ctx: BotContext,
  number: string | undefined,
): Promise<{ view: View; customerId: string } | null> {
  const { customer } = await loadProfile(ctx);
  if (customer === null || number === undefined || !/^NV-\d{4}-\d{4,}$/.test(number)) return null;
  try {
    return {
      view: await orders.getCustomerOrder({ customerId: customer.id, number }, ctx.deps.rt),
      customerId: customer.id,
    };
  } catch (err) {
    if (err instanceof orders.NotFoundError || err instanceof orders.ValidationError) return null;
    throw err;
  }
}

const expired = (ctx: BotContext, view: View): boolean =>
  view.quote?.validUntil != null && view.quote.validUntil.getTime() < ctx.deps.now().getTime();

/** Both offers are published (or the development mode, where the automaton lets a stub through to test the flow). */
const canAccept = async (ctx: BotContext): Promise<boolean> =>
  ctx.deps.appMode === "development" || (await offersPublished(ctx.deps.db));

async function paymentBlock(ctx: BotContext, view: View): Promise<string> {
  const expectedSum = (kind: string) =>
    view.payments.find((p) => p.kind === kind && p.status === "expected")?.amountSum;
  const lines = [ctx.t("my.payment_title")];
  const advance = expectedSum("fee_advance");
  const funds = expectedSum("purchase_funds");
  if (advance !== undefined) lines.push(ctx.t("my.pay.advance", { sum: sumText(advance, ctx.lang) }));
  if (funds !== undefined) {
    lines.push(ctx.t("my.pay.funds", { sum: sumText(funds, ctx.lang) }));
    const requisites = await paymentRequisites(ctx.deps.db);
    if (requisites !== null && !CARD_NUMBER.test(requisites.text) && !CARD_NUMBER.test(requisites.purpose ?? "")) {
      lines.push(ctx.t("my.pay.requisites", { requisites: requisites.text }));
      if (requisites.purpose !== undefined) {
        lines.push(ctx.t("my.pay.purpose", { purpose: requisites.purpose.replaceAll("{number}", view.number) }));
      }
    } else if (requisites !== null) {
      ctx.deps.log.warn({ number: view.number }, "the requisites look like a card number: not shown");
    }
  }
  lines.push(ctx.t("my.pay.no_card"), ctx.t("my.pay.owner_confirms"));
  return lines.join("\n");
}

async function showCard(ctx: BotContext, view: View) {
  const t = ctx.t;
  const lines = [t("my.card", { number: view.number, status: t(`my.status.${view.customerStatus}`) })];
  const rows: InlineButton[][] = [];
  const quote = view.quote;
  if (quote !== null) {
    lines.push(quoteLine(ctx, quote));
    if (quote.watermarkDraft) lines.push(t("my.quote_watermark"));
  }
  if (view.status === "estimate_sent" || view.status === "estimate_expired") {
    if (view.status === "estimate_expired" || expired(ctx, view)) {
      lines.push(t("my.quote_expired"));
    } else if (quote !== null && (await canAccept(ctx))) {
      // The button carries the version of the estimate on this screen (see `acceptance`).
      rows.push([button(t("my.accept_button"), orderCallback(view.number, "acc", String(quote.version)))]);
    } else if (quote !== null) {
      lines.push(t("my.accept_after_publication"));
    }
  }
  if (view.purchases.length > 0) {
    const total = view.purchases.reduce((s, p) => s + p.amountSum, 0);
    lines.push(t("my.purchases", { count: view.purchases.length, sum: sumText(total, ctx.lang) }));
  }
  if (view.status === "accepted") lines.push(await paymentBlock(ctx, view));
  if (view.status === "report_sent") {
    rows.push([
      button(t("my.report_ok"), orderCallback(view.number, "rok")),
      button(t("my.report_question"), orderCallback(view.number, "obj")),
    ]);
  }
  if (view.status === "handed_over" || view.status === "closed") {
    rows.push([button(t("my.warranty_button"), orderCallback(view.number, "warr"))]);
  }
  return say(ctx, lines.join("\n"), rows);
}

async function showList(ctx: BotContext) {
  await ack(ctx);
  const { customer } = await loadProfile(ctx);
  const list = customer === null ? [] : await orders.listCustomerOrders({ customerId: customer.id }, ctx.deps.rt);
  if (list.length === 0) return say(ctx, ctx.t("my.empty"));
  await say(ctx, ctx.t("my.list_title"));
  for (const o of list.slice(0, 5)) {
    await say(ctx, ctx.t("my.card", { number: o.number, status: ctx.t(`my.status.${o.customerStatus}`) }), [
      [button(ctx.t("my.open"), orderCallback(o.number, "view"))],
    ]);
  }
}

/** The consent of a kind for this order, recorded once; returns its id. */
async function orderConsent(
  ctx: BotContext,
  customerId: string,
  orderId: string,
  kind: "supplier_data_transfer" | "non_returnable",
): Promise<string> {
  const known = await latestConsent(ctx.deps.db, customerId, kind, orderId);
  if (known?.granted) return known.id;
  const offer = await content.getPublishedLegalDocument(ctx.deps.db, "offer", ctx.lang);
  const { id } = await consents.record(
    {
      kind,
      customerId,
      orderId,
      granted: true,
      channel: "bot",
      lang: ctx.lang,
      ...(offer === null ? {} : { documentId: offer.id }),
      evidence: { messageId: ctx.callbackQuery?.message?.message_id ?? 0, telegramUserId: ctx.from?.id ?? 0 },
    },
    ctx.deps.rt,
  );
  return id;
}

/** The sums of the estimate: the same lines as in the card. */
const quoteLine = (ctx: BotContext, quote: NonNullable<View["quote"]>): string =>
  ctx.t("my.quote", {
    fee: sumText(quote.feeTotal, ctx.lang),
    limit: sumText(quote.purchaseLimit, ctx.lang),
    until: quote.validUntil === null ? "—" : when(ctx, quote.validUntil),
  });

/**
 * The acceptance is of the version of the estimate the customer saw: the buttons carry its number. An older button
 * (the estimate was revised and sent again) accepts nothing; the customer gets the fresh card to look at.
 * A confirmation without a version is no confirmation: only a button of ours carries one.
 */
async function acceptance(ctx: BotContext, number: string, confirm: boolean, seen: string | undefined) {
  const found = await orderOf(ctx, number);
  if (found === null) return say(ctx, ctx.t("my.not_found"));
  const { view, customerId } = found;
  const quote = view.quote;
  if (view.status === "accepted" && confirm) {
    // A second press of the confirmation: nothing is recorded again, the instruction is shown again.
    return say(ctx, `${ctx.t("my.accept.done")}\n${await paymentBlock(ctx, view)}`);
  }
  if (view.status !== "estimate_sent" || quote === null) return say(ctx, ctx.t("my.error.invalid_transition"));
  if (expired(ctx, view)) return say(ctx, ctx.t("my.error.estimate_expired"));
  if (!(await canAccept(ctx))) return say(ctx, ctx.t("my.error.offer_not_published"));
  const seenVersion = seen !== undefined && /^[0-9]{1,9}$/.test(seen) ? Number(seen) : undefined;
  if (seenVersion === undefined ? confirm : seenVersion !== quote.version) {
    await say(ctx, ctx.t("my.accept.changed"));
    return showCard(ctx, view);
  }
  const hasNonReturnable = quote.lines.some((l) => l.returnable === "no" && !l.customerOwned);
  if (!confirm) {
    const text = [
      ctx.t("my.accept.screen", { number: view.number }),
      quoteLine(ctx, quote),
      hasNonReturnable ? ctx.t("my.accept.non_returnable") : "",
    ]
      .filter((l) => l !== "")
      .join("\n");
    return say(ctx, text, [[button(ctx.t("my.accept.confirm"), orderCallback(view.number, "acc2", String(quote.version)))]]);
  }
  const pd = await latestConsent(ctx.deps.db, customerId, "pd_processing", null);
  if (pd === null || !pd.granted) return say(ctx, ctx.t("my.error.consent_missing"));
  const consentIds = [pd.id, await orderConsent(ctx, customerId, view.orderId, "supplier_data_transfer")];
  if (hasNonReturnable) consentIds.push(await orderConsent(ctx, customerId, view.orderId, "non_returnable"));
  const result = await dispatch(
    view.orderId,
    { type: "ACCEPT", quoteId: quote.quoteId, consentIds, channel: "bot" },
    { kind: "customer", id: customerId },
    ctx.deps.rt,
  );
  if (!result.ok) return say(ctx, refusal(ctx, result.error));
  await clearButtons(ctx);
  const after = await orders.getCustomerOrder({ customerId, orderId: view.orderId }, ctx.deps.rt);
  await say(ctx, ctx.t("my.accept.done"));
  return say(ctx, await paymentBlock(ctx, after));
}

export const myOrders = new Composer<BotContext>();

myOrders.command("order", showList);
myOrders.callbackQuery("m:order", showList);

myOrders.callbackQuery(/^o:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const [number, action, arg] = data?.args ?? [];
  if (number === undefined) return ack(ctx);
  await ack(ctx);
  switch (action) {
    case "view": {
      const found = await orderOf(ctx, number);
      return found === null ? say(ctx, ctx.t("my.not_found")) : showCard(ctx, found.view);
    }
    case "acc":
      return acceptance(ctx, number, false, arg);
    case "acc2":
      return acceptance(ctx, number, true, arg);
    case "rok": {
      const found = await orderOf(ctx, number);
      if (found === null) return say(ctx, ctx.t("my.not_found"));
      const result = await reports.accept(
        { orderId: found.view.orderId },
        { kind: "customer", id: found.customerId },
        ctx.deps.rt,
      );
      if (!result.ok) return say(ctx, refusal(ctx, result.error));
      await clearButtons(ctx);
      return say(ctx, ctx.t("my.report.ok_done"));
    }
    case "obj": {
      const found = await orderOf(ctx, number);
      if (found === null) return say(ctx, ctx.t("my.not_found"));
      if (found.view.status !== "report_sent") return say(ctx, ctx.t("my.error.invalid_transition"));
      ctx.session.step = "report_question";
      ctx.session.draft.orderNumber = found.view.number;
      return say(ctx, ctx.t("my.report.ask"));
    }
    default:
      // «warr» and the buttons of the owner (card, ev) are other handlers' or not the customer's.
      return;
  }
});

/** The text of the question to the report: one message, up to 2000 characters. */
myOrders.on("message", async (ctx, next) => {
  if (ctx.session.step !== "report_question") return next();
  const text = ctx.message.text?.trim();
  if (text === undefined || text === "" || text.length > MAX_QUESTION || text.startsWith("/")) {
    return say(ctx, ctx.t("my.report.ask"));
  }
  const found = await orderOf(ctx, ctx.session.draft.orderNumber);
  ctx.session.step = "idle";
  delete ctx.session.draft.orderNumber;
  if (found === null) return say(ctx, ctx.t("my.not_found"));
  const result = await reports.object(
    { orderId: found.view.orderId, text },
    { kind: "customer", id: found.customerId },
    ctx.deps.rt,
  );
  if (!result.ok)
    return say(ctx, result.error === "invalid_transition" ? ctx.t("my.report.closed") : refusal(ctx, result.error));
  return say(ctx, ctx.t("my.report.sent"));
});
