// The card of an order in the topic of the owner's group (ARCHITECTURE 7.2: «карточка с кнопками, события автомата по
// роли»). The buttons are the events of the automaton the role may send and that need nothing but the press; the money
// events (confirm a payment, record a purchase) and the ones with a document are made in the admin panel. The database
// checks the actor again whatever the button says (DATA-MAP 2).

import { sales } from "@nivel/db/repos";
import type { OrderEvent, OrderStatus } from "@nivel/domain/order";
import { orderTransitionTable } from "@nivel/domain/order";
import { orders } from "@nivel/services";
import { orderCallback, sumText } from "@nivel/telegram";
import type { BotContext } from "./context.ts";
import { button, type Rows } from "./ui.ts";

/** The events a press can send: no payload but the type. */
export const BUTTON_EVENTS = [
  "REVISE",
  "MEETING_DONE",
  "START_PURCHASE",
  "PURCHASE_DONE",
  "ASSEMBLED",
  "DISPATCH",
] as const satisfies readonly OrderEvent["type"][];
export type ButtonEvent = (typeof BUTTON_EVENTS)[number];

export const isButtonEvent = (v: unknown): v is ButtonEvent => (BUTTON_EVENTS as readonly unknown[]).includes(v);

const TABLE = orderTransitionTable();

/** The events the role may send from the status, in the order of BUTTON_EVENTS. */
export function eventsFor(status: OrderStatus, role: "owner" | "assistant"): ButtonEvent[] {
  const allowed = new Set(TABLE.filter((r) => r.from === status && r.actors.includes(role)).map((r) => r.event));
  return BUTTON_EVENTS.filter((e) => allowed.has(e));
}

export interface Card {
  text: string;
  rows: Rows;
}

/** The text and the buttons of the order for the role; every number comes from the database. */
export async function orderCard(ctx: BotContext, orderId: string, role: "owner" | "assistant"): Promise<Card | null> {
  const { db, rt } = ctx.deps;
  const order = await sales.getOrder(db, orderId);
  if (order === null) return null;
  const t = ctx.t;
  const money = await sales.orderMoney(db, order.id);
  let fee = "—";
  let limit = "—";
  try {
    const view = await orders.getCustomerOrder({ customerId: order.customerId, orderId: order.id }, rt);
    if (view.quote !== null) {
      fee = sumText(view.quote.feeTotal, ctx.lang);
      limit = sumText(view.quote.purchaseLimit, ctx.lang);
    }
  } catch (err) {
    // An order that has no quote the customer was shown yet has no numbers to show: the dashes stay. A failure of the
    // database is not that: it goes up, so that the owner is not shown dashes as if there were no estimate.
    if (!(err instanceof orders.NotFoundError || err instanceof orders.ValidationError)) throw err;
  }
  const text = t("owner.card.order", {
    number: order.number,
    status: t(`owner.status.${order.status}`),
    fee,
    limit,
    funds: sumText(money.fundsReceived, ctx.lang),
    receipts: sumText(money.receiptsTotal, ctx.lang),
  });
  const rows: Rows = eventsFor(order.status, role).map((e) => [
    button(t(`owner.event.${e}`), orderCallback(order.number, "ev", e)),
  ]);
  return { text, rows };
}
