// Steps of the life of an order for the integration tests of the bot, built from the scenarios themselves. What the
// admin panel does in production (convert a lead, build and send the quote, confirm the money, record a purchase) is
// done here with the admin runtime; what the bot does is done by the bot under test.
import { consents, dispatch, leads, quotes } from "@nivel/services";
import { openLeadTopic } from "../topics.ts";
import type { Person } from "./fake-telegram.ts";
import { type Harness, onboard } from "./harness.ts";
import { type BotWorld, pcLines } from "./world.ts";

export const ownerActor = (w: BotWorld) => ({ kind: "owner" as const, id: w.owner.id });

export interface LeadCase {
  customerId: string;
  leadId: string;
  leadNumber: string;
  topicId: number;
  person: Person;
}

/** A customer who agreed (through the bot), his request and its topic in the owner's group. */
export async function customerWithLead(w: BotWorld, h: Harness, person: Person): Promise<LeadCase> {
  await onboard(h, person, (person.language_code as "uz" | "ru") ?? "uz");
  const { rows } = await w.db.$client.query("select id from sales.customers where telegram_user_id = $1", [person.id]);
  const customerId = rows[0].id as string;
  const lead = await leads.create({ channel: "bot", scope: "pc", customerId, district: "Chilonzor" }, w.bot);
  const topicId = await openLeadTopic(h.bot.api, h.deps, lead.leadId);
  if (topicId === null) throw new Error("the topic was not made");
  return { customerId, leadId: lead.leadId, leadNumber: lead.number, topicId, person };
}

export interface OrderCase extends LeadCase {
  orderId: string;
  number: string;
}

/** The owner turns the request into an order (the admin panel does it). */
export async function orderOf(w: BotWorld, c: LeadCase): Promise<OrderCase> {
  const order = await leads.convert({ leadId: c.leadId }, ownerActor(w), w.admin);
  return { ...c, orderId: order.orderId, number: order.number };
}

export interface QuotedOrder extends OrderCase {
  quoteId: string;
}

/** The estimate is built from the whole PC, checked by the owner and sent. */
export async function sentOrder(w: BotWorld, c: LeadCase): Promise<QuotedOrder> {
  const o = await orderOf(w, c);
  const built = await quotes.build(
    { orderId: o.orderId, lines: pcLines(w), tasks: ["gaming"] },
    ownerActor(w),
    w.admin,
  );
  const sent = await quotes.send({ orderId: o.orderId, quoteId: built.quoteId }, ownerActor(w), w.admin);
  if (!sent.ok) throw new Error(`the estimate was not sent: ${sent.error}`);
  return { ...o, quoteId: built.quoteId };
}

/** The customer accepts: the consents, then ACCEPT as the customer (what the button does). */
export async function acceptedOrder(w: BotWorld, c: LeadCase): Promise<QuotedOrder> {
  const o = await sentOrder(w, c);
  const ids: string[] = [];
  for (const kind of ["supplier_data_transfer", "non_returnable"] as const) {
    ids.push(
      (
        await consents.record(
          { kind, customerId: o.customerId, orderId: o.orderId, granted: true, channel: "bot" },
          w.bot,
        )
      ).id,
    );
  }
  const pd = await w.db.$client.query(
    "select id from ops.consents where customer_id = $1 and kind = 'pd_processing' order by at desc limit 1",
    [o.customerId],
  );
  ids.unshift(pd.rows[0].id as string);
  const r = await dispatch(
    o.orderId,
    { type: "ACCEPT", quoteId: o.quoteId, consentIds: ids, channel: "bot" },
    { kind: "customer", id: o.customerId },
    w.bot,
  );
  if (!r.ok) throw new Error(`the estimate was not accepted: ${r.error}`);
  return o;
}
