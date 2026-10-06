// Steps of the life of an order for the integration tests, built from the scenarios themselves: every test file that
// needs an order "in the status X" walks the same road the product does (not part of the public API).

import { record } from "../consents/index.ts";
import { convert, create as createLead } from "../leads/index.ts";
import { dispatch } from "../orders/dispatch.ts";
import { confirm, expect as expectPayment } from "../payments/index.ts";
import { type BuiltQuote, build } from "../quotes/build.ts";
import type { ManualLine } from "../quotes/compute.ts";
import { send } from "../quotes/send.ts";
import { newCustomer, pcLines, type World } from "./world.ts";

export interface TestOrder {
  orderId: string;
  customerId: string;
  number: string;
  quoteId: string;
  quote: BuiltQuote;
}

let telegram = 7_500_000_000;
export const ownerActor = (w: World) => ({ kind: "owner" as const, id: w.owner.id });
export const customerActor = (o: { customerId: string }) => ({ kind: "customer" as const, id: o.customerId });
export const SYSTEM = { kind: "system" as const, id: "system" };

/** A lead of the bot turned into an order with a built draft estimate of the whole PC. */
export async function draftOrder(
  w: World,
  o: { lines?: ReturnType<typeof pcLines>; manualLines?: ManualLine[] } = {},
): Promise<TestOrder> {
  telegram += 1;
  const lead = await createLead({ channel: "bot", scope: "pc", customer: { telegramUserId: telegram } }, w.bot);
  const order = await convert({ leadId: lead.leadId }, ownerActor(w), w.admin);
  const quote = await build(
    {
      orderId: order.orderId,
      lines: o.lines ?? pcLines(w),
      tasks: ["gaming"],
      ...(o.manualLines ? { manualLines: o.manualLines } : {}),
    },
    ownerActor(w),
    w.admin,
  );
  return { orderId: order.orderId, customerId: lead.customerId, number: order.number, quoteId: quote.quoteId, quote };
}

/** The estimate is checked by the owner and sent. */
export async function sentOrder(w: World): Promise<TestOrder> {
  const o = await draftOrder(w);
  const r = await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin);
  if (!r.ok) throw new Error(`the estimate was not sent: ${r.error}`);
  return o;
}

/** The consents the customer gives before pressing "Accept"; the PC of the tests has one non-returnable position. */
export async function acceptConsents(w: World, o: TestOrder, o2: { nonReturnable?: boolean } = {}): Promise<string[]> {
  const ids: string[] = [];
  ids.push(
    (await record({ kind: "pd_processing", customerId: o.customerId, granted: true, channel: "bot" }, w.bot)).id,
  );
  ids.push(
    (
      await record(
        { kind: "supplier_data_transfer", customerId: o.customerId, orderId: o.orderId, granted: true, channel: "bot" },
        w.bot,
      )
    ).id,
  );
  if (o2.nonReturnable !== false) {
    ids.push(
      (
        await record(
          { kind: "non_returnable", customerId: o.customerId, orderId: o.orderId, granted: true, channel: "bot" },
          w.bot,
        )
      ).id,
    );
  }
  return ids;
}

/** The customer accepts the offer and the estimate (the bot acts for the customer). */
export async function acceptedOrder(w: World): Promise<TestOrder> {
  const o = await sentOrder(w);
  const consentIds = await acceptConsents(w, o);
  const r = await dispatch(
    o.orderId,
    { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
    customerActor(o),
    w.bot,
  );
  if (!r.ok) throw new Error(`the estimate was not accepted: ${r.error}`);
  return o;
}

/** The advance and the money for purchases are paid and confirmed, both flags are up (the owner opens them). */
export async function paidOrder(w: World): Promise<TestOrder & { advanceId: string; fundsId: string }> {
  w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
  const o = await acceptedOrder(w);
  const advanceId = (await expectPayment({ orderId: o.orderId, kind: "fee_advance" }, ownerActor(w), w.admin))
    .paymentId;
  const fundsId = (await expectPayment({ orderId: o.orderId, kind: "purchase_funds" }, ownerActor(w), w.admin))
    .paymentId;
  await confirm({ paymentId: advanceId, fiscalReceiptNo: `FR-${advanceId.slice(-8)}` }, ownerActor(w), w.admin);
  await confirm({ paymentId: fundsId, bankDocNo: `PP-${fundsId.slice(-8)}` }, ownerActor(w), w.admin);
  const a = await dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: advanceId }, ownerActor(w), w.admin);
  const f = await dispatch(
    o.orderId,
    { type: "FUNDS_RECEIVED", paymentIds: [fundsId], receivedAt: w.clock.now() },
    ownerActor(w),
    w.admin,
  );
  if (!a.ok || !f.ok) throw new Error(`the payments were not accepted: ${JSON.stringify([a, f])}`);
  return { ...o, advanceId, fundsId };
}

/** The next working day has come and the owner starts the purchases. */
export async function purchasingOrder(
  w: World,
): Promise<ReturnType<typeof paidOrder> extends Promise<infer T> ? T : never> {
  const o = await paidOrder(w);
  w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
  const r = await dispatch(o.orderId, { type: "START_PURCHASE" }, ownerActor(w), w.admin);
  if (!r.ok) throw new Error(`the purchase did not start: ${r.error}`);
  return o;
}

export { newCustomer };
