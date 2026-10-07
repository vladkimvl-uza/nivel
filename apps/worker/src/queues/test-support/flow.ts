// Steps of the life of an order for the integration tests of the worker, built from the scenarios of the services themselves
// (not part of the product): every test that needs "an order in status X" walks the road the product does.
import { consents, leads, orders, payments, purchases, quotes, reports } from "@nivel/services";
import { newCustomer, newFile, PC_CATALOG, pcLines, type World } from "./world.ts";

export interface TestOrder {
  orderId: string;
  customerId: string;
  number: string;
  quoteId: string;
  quote: quotes.BuiltQuote;
}

let telegram = 7_600_000_000;
export const ownerActor = (w: World) => ({ kind: "owner" as const, id: w.owner.id });
export const customerActor = (o: { customerId: string }) => ({ kind: "customer" as const, id: o.customerId });
export const SYSTEM = { kind: "system" as const, id: "system" };

/** A request of the bot turned into an order with a built draft estimate of the whole PC. */
export async function draftOrder(w: World, o: { lang?: "uz" | "ru"; withTelegram?: boolean } = {}): Promise<TestOrder> {
  telegram += 1;
  const lead = await leads.create({ channel: "bot", scope: "pc", customer: { telegramUserId: telegram } }, w.bot);
  const order = await leads.convert({ leadId: lead.leadId }, ownerActor(w), w.admin);
  const quote = await quotes.build(
    { orderId: order.orderId, lines: pcLines(w), tasks: ["gaming"] },
    ownerActor(w),
    w.admin,
  );
  const customerId = lead.customerId as string;
  if (o.lang === "ru") await w.db.$client.query("update sales.customers set lang = 'ru' where id = $1", [customerId]);
  if (o.withTelegram === false) {
    await w.db.$client.query("update sales.customers set telegram_user_id = null where id = $1", [customerId]);
  }
  return { orderId: order.orderId, customerId, number: order.number, quoteId: quote.quoteId, quote };
}

export async function sentOrder(w: World): Promise<TestOrder> {
  const o = await draftOrder(w);
  const r = await quotes.send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin);
  if (!r.ok) throw new Error(`the estimate was not sent: ${r.error}`);
  return o;
}

async function acceptConsents(w: World, o: TestOrder, via: "bot" | "web"): Promise<string[]> {
  const rt = via === "web" ? w.web : w.bot;
  const channel = via === "web" ? "site" : "bot";
  const ids: string[] = [];
  ids.push((await consents.record({ kind: "pd_processing", customerId: o.customerId, granted: true, channel }, rt)).id);
  for (const kind of ["supplier_data_transfer", "non_returnable"] as const) {
    ids.push(
      (await consents.record({ kind, customerId: o.customerId, orderId: o.orderId, granted: true, channel }, rt)).id,
    );
  }
  return ids;
}

/**
 * The customer accepts the offer and the estimate. Through the bot the payments are expected at once (the bot may call
 * sales.expect_payment); through the site they are queued as the job payment.expect for the worker.
 */
export async function acceptedOrder(w: World, o2: { via?: "bot" | "web" } = {}): Promise<TestOrder> {
  const via = o2.via ?? "bot";
  const o = await sentOrder(w);
  const consentIds = await acceptConsents(w, o, via);
  const r = await orders.dispatch(
    o.orderId,
    { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: via === "web" ? "site" : "bot" },
    customerActor(o),
    via === "web" ? w.web : w.bot,
  );
  if (!r.ok) throw new Error(`the estimate was not accepted: ${r.error}`);
  return o;
}

/** The advance and the money for the purchases are paid and confirmed, both flags are up. */
export async function paidOrder(w: World): Promise<TestOrder & { advanceId: string; fundsId: string }> {
  const o = await acceptedOrder(w);
  const advanceId = (await payments.expect({ orderId: o.orderId, kind: "fee_advance" }, ownerActor(w), w.admin))
    .paymentId;
  const fundsId = (await payments.expect({ orderId: o.orderId, kind: "purchase_funds" }, ownerActor(w), w.admin))
    .paymentId;
  await payments.confirm(
    { paymentId: advanceId, fiscalReceiptNo: `FR-${advanceId.slice(-8)}` },
    ownerActor(w),
    w.admin,
  );
  await payments.confirm({ paymentId: fundsId, bankDocNo: `PP-${fundsId.slice(-8)}` }, ownerActor(w), w.admin);
  const a = await orders.dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: advanceId }, ownerActor(w), w.admin);
  const f = await orders.dispatch(
    o.orderId,
    { type: "FUNDS_RECEIVED", paymentIds: [fundsId], receivedAt: w.clock.now() },
    ownerActor(w),
    w.admin,
  );
  if (!a.ok || !f.ok) throw new Error(`the payments were not accepted: ${JSON.stringify([a, f])}`);
  return { ...o, advanceId, fundsId };
}

/** The next working day has come and the owner starts the purchases. */
export async function purchasingOrder(w: World) {
  const o = await paidOrder(w);
  // The money came today; purchases may start from the next working day (purchase_not_before of the order).
  const { rows } = await w.db.$client.query("select purchase_not_before from sales.orders where id = $1", [o.orderId]);
  w.clock.set(rows[0].purchase_not_before as Date);
  const r = await orders.dispatch(o.orderId, { type: "START_PURCHASE" }, ownerActor(w), w.admin);
  if (!r.ok) throw new Error(`the purchase did not start: ${r.error}`);
  return o;
}

let receipt = 9000;

/** Every position of the quote is bought at its price, each with a fiscal receipt and a photo; the purchases are closed. */
export async function purchasedOrder(w: World) {
  const o = await purchasingOrder(w);
  for (const p of PC_CATALOG) {
    const { rows } = await w.db.$client.query(
      "select id from sales.quote_lines where quote_id = $1 and product_id = $2",
      [o.quoteId, w.products[p.key].id],
    );
    receipt += 1;
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
        receiptNo: `WCH-${receipt}`,
        receiptFileIds: [(await newFile(w)).id],
      },
      ownerActor(w),
      w.admin,
    );
    if (!r.ok) throw new Error(`the purchase of ${p.key} was refused: ${r.error}`);
  }
  const done = await orders.dispatch(o.orderId, { type: "PURCHASE_DONE" }, ownerActor(w), w.admin);
  if (!done.ok) throw new Error(`the purchases were not closed: ${done.error}`);
  return o;
}

/** The report is generated and sent by the owner: the window of objections is open. */
export async function reportSentOrder(w: World) {
  const o = await purchasedOrder(w);
  const report = await reports.generate({ orderId: o.orderId }, ownerActor(w), w.admin);
  const sent = await reports.send({ orderId: o.orderId, reportId: report.reportId }, ownerActor(w), w.admin);
  if (!sent.ok) throw new Error(`the report was not sent: ${sent.error}`);
  return o;
}

/**
 * The report is accepted by the customer, the remainder is returned: the order is settled with the customer. `via: "bot"`
 * settles as the owner pressing the button in the group: the bot cannot write the reserve ledger and queues ledger.append.
 */
export async function settledOrder(w: World, o2: { via?: "admin" | "bot" } = {}) {
  const o = await reportSentOrder(w);
  const accepted = await reports.accept({ orderId: o.orderId }, customerActor(o), w.bot);
  if (!accepted.ok) throw new Error(`the report was not accepted: ${accepted.error}`);
  const refund = (
    await w.db.$client.query("select id from sales.payments where order_id = $1 and kind = 'remainder_refund'", [
      o.orderId,
    ])
  ).rows[0];
  if (refund) {
    await payments.confirm({ paymentId: refund.id, bankDocNo: `PP-${refund.id.slice(-8)}` }, ownerActor(w), w.admin);
  }
  const viaBot = o2.via === "bot";
  const settled = await orders.dispatch(
    o.orderId,
    { type: "REMAINDER_SETTLED", ...(refund ? { refundPaymentId: refund.id } : {}) },
    viaBot ? { kind: "owner", id: w.owner.telegramId } : ownerActor(w),
    viaBot ? w.bot : w.admin,
  );
  if (!settled.ok) throw new Error(`the remainder was not settled: ${settled.error}`);
  return o;
}

export { newCustomer };
