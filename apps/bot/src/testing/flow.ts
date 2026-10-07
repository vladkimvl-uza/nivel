// Steps of the life of an order for the integration tests of the bot, built from the scenarios themselves. What the
// admin panel does in production (convert a lead, build and send the quote, confirm the money, record a purchase) is
// done here with the admin runtime; what the bot does is done by the bot under test.
import { consents, dispatch, leads, payments, purchases, quotes, reports } from "@nivel/services";
import { openLeadTopic } from "../topics.ts";
import type { Person } from "./fake-telegram.ts";
import { type Harness, onboard } from "./harness.ts";
import { type BotWorld, newFile, PC_CATALOG, pcLines } from "./world.ts";

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

/** The advance and the money for purchases are paid and confirmed by the owner (the admin panel), both flags are up. */
export async function paidOrder(w: BotWorld, c: LeadCase): Promise<QuotedOrder> {
  w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
  const o = await acceptedOrder(w, c);
  const advance = await payments.expect({ orderId: o.orderId, kind: "fee_advance" }, ownerActor(w), w.admin);
  const funds = await payments.expect({ orderId: o.orderId, kind: "purchase_funds" }, ownerActor(w), w.admin);
  await payments.confirm(
    { paymentId: advance.paymentId, fiscalReceiptNo: `FR-${advance.paymentId.slice(-8)}` },
    ownerActor(w),
    w.admin,
  );
  await payments.confirm(
    { paymentId: funds.paymentId, bankDocNo: `PP-${funds.paymentId.slice(-8)}` },
    ownerActor(w),
    w.admin,
  );
  const a = await dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: advance.paymentId }, ownerActor(w), w.admin);
  const f = await dispatch(
    o.orderId,
    { type: "FUNDS_RECEIVED", paymentIds: [funds.paymentId], receivedAt: w.clock.now() },
    ownerActor(w),
    w.admin,
  );
  if (!a.ok || !f.ok) throw new Error(`the payments were not accepted: ${JSON.stringify([a, f])}`);
  return o;
}

let receiptNo = 7000;

/** The next working day has come, the purchase starts and every position is bought with a receipt and a photo. */
export async function purchasedOrder(w: BotWorld, c: LeadCase): Promise<QuotedOrder> {
  const o = await paidOrder(w, c);
  w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
  const start = await dispatch(o.orderId, { type: "START_PURCHASE" }, ownerActor(w), w.admin);
  if (!start.ok) throw new Error(`the purchase did not start: ${start.error}`);
  for (const p of PC_CATALOG) {
    const { rows } = await w.db.$client.query(
      "select id from sales.quote_lines where quote_id = $1 and product_id = $2",
      [o.quoteId, w.products[p.key].id],
    );
    receiptNo += 1;
    const r = await purchases.record(
      {
        orderId: o.orderId,
        vendorId: w.vendorId,
        quoteLineId: rows[0].id,
        productId: w.products[p.key].id,
        qty: 1,
        amountSum: p.price,
        paidVia: "bank_transfer",
        receiptKind: "fiscal",
        receiptNo: `CH-${receiptNo}`,
        receiptFileIds: [await newFile(w)],
      },
      ownerActor(w),
      w.admin,
    );
    if (!r.ok) throw new Error(`the purchase of ${p.key} was refused: ${r.error}`);
  }
  const done = await dispatch(o.orderId, { type: "PURCHASE_DONE" }, ownerActor(w), w.admin);
  if (!done.ok) throw new Error(`the purchases were not closed: ${done.error}`);
  return o;
}

/** The owner sends the report of the commission (status report_sent). */
export async function reportSentOrder(w: BotWorld, c: LeadCase): Promise<QuotedOrder> {
  const o = await purchasedOrder(w, c);
  const report = await reports.generate({ orderId: o.orderId }, ownerActor(w), w.admin);
  const sent = await reports.send({ orderId: o.orderId, reportId: report.reportId }, ownerActor(w), w.admin);
  if (!sent.ok) throw new Error(`the report was not sent: ${sent.error}`);
  return o;
}

/** The customer has accepted the report and the remainder is returned: settled with the customer. */
export async function settledOrder(w: BotWorld, c: LeadCase): Promise<QuotedOrder> {
  const o = await reportSentOrder(w, c);
  const accepted = await reports.accept({ orderId: o.orderId }, { kind: "customer", id: o.customerId }, w.bot);
  if (!accepted.ok) throw new Error(`the report was not accepted: ${accepted.error}`);
  const refund = (
    await w.db.$client.query("select id from sales.payments where order_id = $1 and kind = 'remainder_refund'", [
      o.orderId,
    ])
  ).rows[0];
  if (refund) {
    await payments.confirm(
      { paymentId: refund.id, bankDocNo: `PP-${String(refund.id).slice(-8)}` },
      ownerActor(w),
      w.admin,
    );
  }
  const settled = await dispatch(
    o.orderId,
    { type: "REMAINDER_SETTLED", ...(refund ? { refundPaymentId: refund.id } : {}) },
    ownerActor(w),
    w.admin,
  );
  if (!settled.ok) throw new Error(`the remainder was not settled: ${settled.error}`);
  return o;
}
