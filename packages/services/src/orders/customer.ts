// What a customer sees of his orders (CONCEPT 5.9, DATA-MAP 2). One path for the site and the bot: the customer views
// `sales.v_customer_order_*`. They hold the rows of ALL customers (the database role of the site is one for everybody and
// cannot tell them apart), so the customer id of the CHECKED session is a parameter of every query here: an order of
// another customer is "not found", exactly like an order that does not exist. The caller passes the id from the session,
// never an id that came with the request.

import type { Executor } from "@nivel/db/repos";
import { customerStatusFor } from "@nivel/domain/order";
import { dsl } from "./dsl.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { type Runtime, runtimeOf } from "./runtime.ts";
import { asDate, assertUuid } from "./validate.ts";

const ORDER_NUMBER = /^NV-\d{4}-\d{4,}$/;

export interface CustomerOrderQuote {
  quoteId: string;
  version: number;
  status: string;
  componentsSum: number;
  reserveSum: number;
  purchaseLimit: number;
  outsideScaleSum: number;
  feeTotal: number;
  feeCommissionLine: number;
  feeWorksLine: number;
  feeAdvance: number;
  feeFinal: number;
  validUntil: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  watermarkDraft: boolean;
  lines: {
    id: string;
    productId: string | null;
    title: string;
    category: string;
    qty: number;
    unitMarketSum: number;
    priceDate: string | null;
    confidence: string | null;
    returnable: string;
    customerOwned: boolean;
  }[];
}

export interface CustomerOrderView {
  orderId: string;
  number: string;
  kind: string;
  status: string;
  customerStatus: ReturnType<typeof customerStatusFor>;
  flags: { feePrepaid: boolean; fundsReceived: boolean };
  acceptedAt: Date | null;
  reportDueAt: Date | null;
  objectionUntil: Date | null;
  refundDueAt: Date | null;
  handedOverAt: Date | null;
  warrantyUntil: Date | null;
  createdAt: Date;
  /** The newest quote the customer was shown (not a draft); null before the first one was sent. */
  quote: CustomerOrderQuote | null;
  payments: {
    paymentId: string;
    kind: string;
    direction: string;
    method: string;
    amountSum: number;
    status: string;
    fiscalReceiptNo: string | null;
    occurredAt: Date | null;
    confirmedAt: Date | null;
  }[];
  purchases: {
    purchaseId: string;
    productTitle: string | null;
    qty: number;
    amountSum: number;
    discountSum: number;
    receiptKind: string;
    receiptNo: string | null;
    esfStatus: string | null;
    vendorName: string | null;
    boughtAt: Date;
  }[];
}

type Row = Record<string, unknown>;

const toNumber = (v: unknown): number => Number(v);

async function head(
  ex: Executor,
  customerId: string,
  key: { orderId: string } | { number: string },
): Promise<Row | undefined> {
  const { sql } = dsl(ex);
  const where = "orderId" in key ? sql`order_id = ${key.orderId}` : sql`number = ${key.number}`;
  const { rows } = await ex.execute<Row>(sql`
    select order_id, number, kind, status, fee_prepaid, funds_received, accepted_at, report_due_at, objection_until,
           refund_due_at, handed_over_at, warranty_until, created_at
      from sales.v_customer_order_status where customer_id = ${customerId} and ${where}`);
  return rows[0];
}

function shape(h: Row): Omit<CustomerOrderView, "quote" | "payments" | "purchases"> {
  const status = String(h.status) as Parameters<typeof customerStatusFor>[0];
  const flags = { feePrepaid: h.fee_prepaid === true, fundsReceived: h.funds_received === true };
  return {
    orderId: String(h.order_id),
    number: String(h.number),
    kind: String(h.kind),
    status,
    customerStatus: customerStatusFor(status, flags),
    flags,
    acceptedAt: asDate(h.accepted_at),
    reportDueAt: asDate(h.report_due_at),
    objectionUntil: asDate(h.objection_until),
    refundDueAt: asDate(h.refund_due_at),
    handedOverAt: asDate(h.handed_over_at),
    warrantyUntil: asDate(h.warranty_until),
    createdAt: asDate(h.created_at) as Date,
  };
}

export async function getCustomerOrder(
  input: { customerId: string; orderId?: string; number?: string },
  rt?: Runtime,
): Promise<CustomerOrderView> {
  const r = runtimeOf(rt);
  const customerId = assertUuid(input.customerId, "customerId");
  if ((input.orderId === undefined) === (input.number === undefined)) {
    throw ValidationError.of(
      "orderId",
      "order_required",
      "name the order by its id or by its number, not both and not neither",
    );
  }
  let key: { orderId: string } | { number: string };
  if (input.orderId !== undefined) {
    key = { orderId: assertUuid(input.orderId, "orderId") };
  } else {
    if (typeof input.number !== "string" || !ORDER_NUMBER.test(input.number)) {
      throw ValidationError.of("number", "number_invalid", "an order number looks like NV-2026-0001");
    }
    key = { number: input.number };
  }
  const found = await head(r.db, customerId, key);
  if (!found) throw new NotFoundError("order");
  const orderId = String(found.order_id);
  const { sql } = dsl(r.db);

  const quotes = await r.db.execute<Row>(sql`
    select quote_id, version, status, components_sum::text, reserve_sum::text, purchase_limit::text, outside_scale_sum::text,
           fee_total::text, fee_commission_line::text, fee_works_line::text, fee_advance::text, fee_final::text,
           valid_until, sent_at, accepted_at, watermark_draft, lines
      from sales.v_customer_order_quotes where customer_id = ${customerId} and order_id = ${orderId}
     order by version desc limit 1`);
  const q = quotes.rows[0];

  const payments = await r.db.execute<Row>(sql`
    select payment_id, kind, direction, method, amount_sum::text, status, fiscal_receipt_no, occurred_at, confirmed_at
      from sales.v_customer_order_payments where customer_id = ${customerId} and order_id = ${orderId}
     order by occurred_at nulls last, payment_id`);
  const purchases = await r.db.execute<Row>(sql`
    select purchase_id, product_title, qty, amount_sum::text, discount_sum::text, receipt_kind, receipt_no, esf_status,
           vendor_name, bought_at
      from sales.v_customer_order_purchases where customer_id = ${customerId} and order_id = ${orderId}
     order by bought_at, purchase_id`);

  return {
    ...shape(found),
    quote: q
      ? {
          quoteId: String(q.quote_id),
          version: toNumber(q.version),
          status: String(q.status),
          componentsSum: toNumber(q.components_sum),
          reserveSum: toNumber(q.reserve_sum),
          purchaseLimit: toNumber(q.purchase_limit),
          outsideScaleSum: toNumber(q.outside_scale_sum),
          feeTotal: toNumber(q.fee_total),
          feeCommissionLine: toNumber(q.fee_commission_line),
          feeWorksLine: toNumber(q.fee_works_line),
          feeAdvance: toNumber(q.fee_advance),
          feeFinal: toNumber(q.fee_final),
          validUntil: asDate(q.valid_until),
          sentAt: asDate(q.sent_at),
          acceptedAt: asDate(q.accepted_at),
          watermarkDraft: q.watermark_draft === true,
          lines: ((q.lines as Row[] | null) ?? []).map((l) => ({
            id: String(l.id),
            productId: (l.productId as string | null) ?? null,
            title: String(l.title),
            category: String(l.category),
            qty: toNumber(l.qty),
            unitMarketSum: toNumber(l.unitMarketSum),
            priceDate: (l.priceDate as string | null) ?? null,
            confidence: (l.confidence as string | null) ?? null,
            returnable: String(l.returnable),
            customerOwned: l.customerOwned === true,
          })),
        }
      : null,
    payments: payments.rows.map((p) => ({
      paymentId: String(p.payment_id),
      kind: String(p.kind),
      direction: String(p.direction),
      method: String(p.method),
      amountSum: toNumber(p.amount_sum),
      status: String(p.status),
      fiscalReceiptNo: (p.fiscal_receipt_no as string | null) ?? null,
      occurredAt: asDate(p.occurred_at),
      confirmedAt: asDate(p.confirmed_at),
    })),
    purchases: purchases.rows.map((p) => ({
      purchaseId: String(p.purchase_id),
      productTitle: (p.product_title as string | null) ?? null,
      qty: toNumber(p.qty),
      amountSum: toNumber(p.amount_sum),
      discountSum: toNumber(p.discount_sum),
      receiptKind: String(p.receipt_kind),
      receiptNo: (p.receipt_no as string | null) ?? null,
      esfStatus: (p.esf_status as string | null) ?? null,
      vendorName: (p.vendor_name as string | null) ?? null,
      boughtAt: asDate(p.bought_at) as Date,
    })),
  };
}

/** The orders of the customer, the newest first: number, status and the customer-facing stage. */
export async function listCustomerOrders(
  input: { customerId: string },
  rt?: Runtime,
): Promise<Omit<CustomerOrderView, "quote" | "payments" | "purchases">[]> {
  const r = runtimeOf(rt);
  const customerId = assertUuid(input.customerId, "customerId");
  const { sql } = dsl(r.db);
  const { rows } = await r.db.execute<Row>(sql`
    select order_id, number, kind, status, fee_prepaid, funds_received, accepted_at, report_due_at, objection_until,
           refund_due_at, handed_over_at, warranty_until, created_at
      from sales.v_customer_order_status where customer_id = ${customerId} order by created_at desc, order_id`);
  return rows.map(shape);
}
