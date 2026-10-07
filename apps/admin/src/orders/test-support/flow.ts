// Steps of the life of an order for the tests of the screens, made with the scenarios themselves: the same road the
// product walks, so that a test can ask for "an order in the status X" (not part of the application).
import type { Db } from "@nivel/db";
import { acts, consents, leads, orders, payments, purchases, quotes, reports } from "@nivel/services";
import { type CatalogSeed, newFile, PC_CATALOG, type PcKey, pcLines } from "./world.ts";

export interface FlowWorld {
  admin: orders.Runtime;
  bot: orders.Runtime;
  db: Db;
  products: CatalogSeed["products"];
  vendorId: string;
  owner: { id: string };
}

export interface TestOrder {
  orderId: string;
  customerId: string;
  number: string;
  quoteId: string;
  totals: Awaited<ReturnType<typeof quotes.build>>["totals"];
}

let telegram = 7_700_000_000 + Math.floor(Math.random() * 100_000_000);
export const ownerOf = (w: FlowWorld) => ({ kind: "owner" as const, id: w.owner.id });
export const customerOf = (o: { customerId: string }) => ({ kind: "customer" as const, id: o.customerId });
export const SYSTEM = { kind: "system" as const, id: "system" };

/** A request of the bot turned into an order, without an estimate. */
export async function leadOrder(w: FlowWorld, name = "Азиз Каримов"): Promise<Omit<TestOrder, "quoteId" | "totals">> {
  telegram += 1;
  const lead = await leads.create(
    { channel: "bot", scope: "pc", customer: { telegramUserId: telegram, displayName: name } },
    w.bot,
  );
  const order = await leads.convert({ leadId: lead.leadId }, ownerOf(w), w.admin);
  return { orderId: order.orderId, customerId: lead.customerId as string, number: order.number };
}

export async function draftOrder(w: FlowWorld, name?: string): Promise<TestOrder> {
  const base = await leadOrder(w, name);
  const quote = await quotes.build(
    { orderId: base.orderId, lines: pcLines(w.products), tasks: ["gaming"] },
    ownerOf(w),
    w.admin,
  );
  return { ...base, quoteId: quote.quoteId, totals: quote.totals };
}

export async function sentOrder(w: FlowWorld, name?: string): Promise<TestOrder> {
  const o = await draftOrder(w, name);
  const r = await quotes.send({ orderId: o.orderId, quoteId: o.quoteId }, ownerOf(w), w.admin);
  if (!r.ok) throw new Error(`the estimate was not sent: ${r.error}`);
  return o;
}

/** The customer accepts in the bot: the three consents, then ACCEPT. */
export async function acceptedOrder(w: FlowWorld, name?: string): Promise<TestOrder> {
  const o = await sentOrder(w, name);
  const ids: string[] = [];
  ids.push(
    (await consents.record({ kind: "pd_processing", customerId: o.customerId, granted: true, channel: "bot" }, w.bot))
      .id,
  );
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
  const r = await orders.dispatch(
    o.orderId,
    { type: "ACCEPT", quoteId: o.quoteId, consentIds: ids, channel: "bot" },
    customerOf(o),
    w.bot,
  );
  if (!r.ok) throw new Error(`the estimate was not accepted: ${r.error}`);
  return o;
}

/** The advance and the money for purchases are paid and confirmed; both flags are up. `receivedAt` is when the money came. */
export async function paidOrder(
  w: FlowWorld,
  o: { receivedAt?: Date; name?: string } = {},
): Promise<TestOrder & { advanceId: string; fundsId: string }> {
  const order = await acceptedOrder(w, o.name);
  const owner = ownerOf(w);
  const advanceId = (await payments.expect({ orderId: order.orderId, kind: "fee_advance" }, owner, w.admin)).paymentId;
  const fundsId = (await payments.expect({ orderId: order.orderId, kind: "purchase_funds" }, owner, w.admin)).paymentId;
  await payments.confirm({ paymentId: advanceId, fiscalReceiptNo: `FR-${advanceId.slice(-8)}` }, owner, w.admin);
  await payments.confirm({ paymentId: fundsId, bankDocNo: `PP-${fundsId.slice(-8)}` }, owner, w.admin);
  const a = await orders.dispatch(order.orderId, { type: "FEE_PREPAID", paymentId: advanceId }, owner, w.admin);
  const f = await orders.dispatch(
    order.orderId,
    { type: "FUNDS_RECEIVED", paymentIds: [fundsId], receivedAt: o.receivedAt ?? w.admin.now() },
    owner,
    w.admin,
  );
  if (!a.ok || !f.ok) throw new Error(`the payments were not accepted: ${JSON.stringify([a, f])}`);
  return { ...order, advanceId, fundsId };
}

/** The money came days ago, so the purchase can start now. */
export async function purchasingOrder(w: FlowWorld, name?: string) {
  const o = await paidOrder(w, {
    receivedAt: new Date(w.admin.now().getTime() - 5 * 86_400_000),
    ...(name ? { name } : {}),
  });
  const r = await orders.dispatch(o.orderId, { type: "START_PURCHASE" }, ownerOf(w), w.admin);
  if (!r.ok) throw new Error(`the purchase did not start: ${r.error}`);
  return o;
}

let receipt = 7000 + Math.floor(Math.random() * 1000);

/** One position bought at its price, with a fiscal receipt and a photo. */
export async function buyPosition(w: FlowWorld, o: TestOrder, key: PcKey) {
  const line = (
    await w.db.$client.query<{ id: string }>(
      "select id from sales.quote_lines where quote_id = $1 and product_id = $2",
      [o.quoteId, w.products[key].id],
    )
  ).rows[0];
  receipt += 1;
  const r = await purchases.record(
    {
      orderId: o.orderId,
      vendorId: w.vendorId,
      ...(line ? { quoteLineId: line.id } : {}),
      productId: w.products[key].id,
      qty: 1,
      amountSum: w.products[key].price,
      paidVia: "bank_transfer",
      receiptKind: "fiscal",
      receiptNo: `CH-${receipt}`,
      receiptFileIds: [await newFile(w.db)],
    },
    ownerOf(w),
    w.admin,
  );
  if (!r.ok) throw new Error(`the purchase of ${key} was refused: ${r.error}`);
  return r.purchaseId;
}

export async function purchasedOrder(w: FlowWorld, name?: string) {
  const o = await purchasingOrder(w, name);
  for (const p of PC_CATALOG) await buyPosition(w, o, p.key);
  const done = await orders.dispatch(o.orderId, { type: "PURCHASE_DONE" }, ownerOf(w), w.admin);
  if (!done.ok) throw new Error(`the purchases were not closed: ${done.error}`);
  return o;
}

/** The report is generated and sent to the customer. */
export async function reportSentOrder(w: FlowWorld, name?: string) {
  const o = await purchasedOrder(w, name);
  const report = await reports.generate({ orderId: o.orderId }, ownerOf(w), w.admin);
  const sent = await reports.send({ orderId: o.orderId, reportId: report.reportId }, ownerOf(w), w.admin);
  if (!sent.ok) throw new Error(`the report was not sent: ${sent.error}`);
  return { ...o, reportId: report.reportId };
}

let paper = 0;

/** The customer accepts the report, the remainder goes back and the owner settles the order. */
export async function settledOrder(w: FlowWorld & { worker?: orders.Runtime }, name?: string) {
  const o = await reportSentOrder(w, name);
  const accepted = await reports.accept({ orderId: o.orderId }, customerOf(o), w.bot);
  if (!accepted.ok) throw new Error(`the report was not accepted: ${accepted.error}`);
  const refund = (
    await w.db.$client.query<{ id: string }>(
      "select id from sales.payments where order_id = $1 and kind = 'remainder_refund'",
      [o.orderId],
    )
  ).rows[0];
  if (refund)
    await payments.confirm({ paymentId: refund.id, bankDocNo: `PP-${refund.id.slice(-8)}` }, ownerOf(w), w.admin);
  const settled = await orders.dispatch(
    o.orderId,
    { type: "REMAINDER_SETTLED", ...(refund ? { refundPaymentId: refund.id } : {}) },
    ownerOf(w),
    w.admin,
  );
  if (!settled.ok) throw new Error(`the remainder was not settled: ${settled.error}`);
  return o;
}

/** An act drawn and signed with the photo of the paper act. */
export async function signedAct(w: FlowWorld, orderId: string, kind: "material_acceptance" | "handover") {
  paper += 1;
  const act = await acts.generate(
    {
      orderId,
      kind,
      ...(kind === "material_acceptance" ? { lines: [{ title: `Материал клиента ${paper}`, qty: 1 }] } : {}),
    },
    ownerOf(w),
    w.admin,
  );
  const fileId = await newFile(w.db, { kind: "act_photo", retention: "order_warranty_plus_3y" });
  await acts.sign({ actId: act.actId, via: "paper_photo", evidence: { fileId } }, ownerOf(w), w.admin);
  return act.actId;
}

/** Assembled, tested (a passport of 7 hours without errors), dispatched; the final part of the fee is expected. */
export async function deliveringOrder(w: FlowWorld & { worker?: orders.Runtime }, name?: string) {
  const o = await settledOrder(w, name);
  const owner = ownerOf(w);
  const materials = await signedAct(w, o.orderId, "material_acceptance");
  const steps: Parameters<typeof orders.dispatch>[1][] = [
    { type: "MATERIALS_ACCEPTED", actId: materials },
    { type: "ASSEMBLED" },
  ];
  for (const e of steps) {
    const r = await orders.dispatch(o.orderId, e, owner, w.admin);
    if (!r.ok) throw new Error(`${e.type} was refused: ${r.error}`);
  }
  await w.db.$client.query(
    `insert into sales.build_passports (order_id, serials, tests) values ($1, '{"Процессор":"SN-1"}', '{"minutes":420,"errors":[]}')`,
    [o.orderId],
  );
  for (const e of [{ type: "TESTS_PASSED", passportId: o.orderId }, { type: "DISPATCH" }] as const) {
    const r = await orders.dispatch(o.orderId, e, owner, w.admin);
    if (!r.ok) throw new Error(`${e.type} was refused: ${r.error}`);
  }
  return o;
}

/** The final part of the fee is paid by the QR with a receipt, the act of handover is signed, the PC is handed over. */
export async function handedOverOrder(w: FlowWorld & { worker?: orders.Runtime }, name?: string) {
  const o = await deliveringOrder(w, name);
  const owner = ownerOf(w);
  const finalId = (
    await w.db.$client.query<{ id: string }>(
      "select id from sales.payments where order_id = $1 and kind = 'fee_final'",
      [o.orderId],
    )
  ).rows[0]?.id as string;
  await payments.confirm({ paymentId: finalId, fiscalReceiptNo: `FR-${finalId.slice(-8)}` }, owner, w.admin);
  const handover = await signedAct(w, o.orderId, "handover");
  const r = await orders.dispatch(
    o.orderId,
    { type: "HANDOVER", actId: handover, finalPaymentId: finalId },
    owner,
    w.admin,
  );
  if (!r.ok) throw new Error(`HANDOVER was refused: ${r.error}`);
  return { ...o, finalId, handoverActId: handover };
}

export { acts };
