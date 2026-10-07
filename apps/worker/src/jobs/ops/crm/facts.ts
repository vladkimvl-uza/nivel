// What the CRM events are made of, read from the database with the rights of nivel_worker (SELECT on the sales tables without the
// address of a customer). Each reader answers the facts of one thing, or `null` when the thing is not there (or is not for the CRM:
// a return to a shop, a partial reversal). The sums are whole sums: bigint columns come as text and are checked.
import type { Db } from "@nivel/db";
import { sales } from "@nivel/db/repos";
import type { LeadFacts, OrderChangeFacts, PaymentFacts, PurchaseFacts, QuoteFacts, WarrantyFacts } from "./events.ts";

function whole(v: string | number | null | undefined, what: string): number {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is not a whole sum: ${String(v)}`);
  return n;
}

// ---- lead.created -------------------------------------------------------------------------------------------------------

export async function loadLeadFacts(db: Db, leadId: string): Promise<LeadFacts | null> {
  const { rows } = await db.$client.query<{
    number: string;
    created_at: Date;
    channel: string;
    utm: Record<string, string> | null;
    lang: "uz" | "ru";
    district: string | null;
    scope: string;
    wanted_by: string | null;
    public_code: string | null;
    customer_id: string | null;
    display_name: string | null;
    telegram_username: string | null;
  }>(
    `select l.number, l.created_at, l.channel, l.utm, l.lang, l.district, l.scope, l.wanted_by::text as wanted_by,
            c.public_code, cu.id as customer_id, cu.display_name, cu.telegram_username
       from sales.leads l
       left join sales.configurations c on c.id = l.configuration_id
       left join sales.customers cu on cu.id = l.customer_id
      where l.id = $1`,
    [leadId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    number: r.number,
    createdAt: r.created_at,
    channel: r.channel,
    utm: r.utm,
    lang: r.lang,
    district: r.district,
    scope: r.scope,
    wantedBy: r.wanted_by,
    configurationCode: r.public_code,
    customer:
      r.customer_id === null
        ? null
        : { ref: r.customer_id, displayName: r.display_name, telegramUsername: r.telegram_username },
  };
}

// ---- order.status_changed -----------------------------------------------------------------------------------------------

const LEDGER_FUND: Record<string, "warranty" | "tax_risk"> = { HANDOVER: "warranty", REMAINDER_SETTLED: "tax_risk" };

/** The state of the report as of the event `upTo`, read from the journal as the services read it (reportStateFrom). */
function reportStateAsOf(
  events: readonly { seq: number; type: string }[],
  resolvedAfterSeq: number | null,
): { accepted: boolean; objectionOpen: boolean } | null {
  const lastSend = events.filter((e) => e.type === "SEND_REPORT").reduce((m, e) => Math.max(m, e.seq), 0);
  if (lastSend === 0) return null;
  const after = events.filter((e) => e.seq > lastSend);
  const accepted = after.some((e) => e.type === "REPORT_ACCEPTED" || e.type === "REPORT_DEEMED_ACCEPTED");
  const lastObjection = after.filter((e) => e.type === "OBJECTION").reduce((m, e) => Math.max(m, e.seq), 0);
  return { accepted, objectionOpen: lastObjection > 0 && lastObjection > (resolvedAfterSeq ?? 0) };
}

export async function loadOrderChangeFacts(db: Db, orderId: string, seq: number): Promise<OrderChangeFacts | null> {
  const q = db.$client;
  const { rows: orderRows } = await q.query<{
    number: string;
    kind: string;
    customer_id: string;
    fee_prepaid: boolean;
    funds_received: boolean;
    first_order_meeting_done: boolean;
    purchase_not_before: Date | null;
    report_due_at: Date | null;
    objection_until: Date | null;
    refund_due_at: Date | null;
    warranty_until: Date | null;
    podbor_credit_until: Date | null;
    cancel: {
      point?: string;
      reason?: string;
      settlement?: Record<string, unknown>;
    } | null;
    current_quote_id: string | null;
    lead_number: string | null;
  }>(
    `select o.number, o.kind, o.customer_id, o.fee_prepaid, o.funds_received, o.first_order_meeting_done,
            o.purchase_not_before, o.report_due_at, o.objection_until, o.refund_due_at, o.warranty_until,
            o.podbor_credit_until, o.cancel, o.current_quote_id, l.number as lead_number
       from sales.orders o left join sales.leads l on l.id = o.lead_id
      where o.id = $1`,
    [orderId],
  );
  const o = orderRows[0];
  if (!o) return null;
  const { rows: journal } = await q.query<{
    seq: number;
    at: Date;
    actor_kind: string;
    type: string;
    from_status: string | null;
    to_status: string;
  }>(
    `select seq, at, actor_kind, event->>'type' as type, from_status, to_status
       from sales.order_events where order_id = $1 and seq <= $2 order by seq`,
    [orderId, seq],
  );
  const e = journal.find((j) => j.seq === seq);
  if (!e) return null;

  let quote: QuoteFacts | null = null;
  if (o.current_quote_id !== null) {
    const { rows } = await q.query<{
      id: string;
      version: number;
      components_sum: string;
      outside_scale_sum: string;
      purchase_limit: string;
      reserve_bp: number;
      reserve_sum: string;
      fee_total: string;
      fee_commission_line: string;
      fee_works_line: string;
      fee_advance: string;
      fee_final: string;
      eligibility: string | null;
      valid_until: Date | null;
      parts: { group?: string; base?: number }[] | null;
    }>(
      `select id, version, components_sum::text, outside_scale_sum::text, purchase_limit::text, reserve_bp,
              reserve_sum::text, fee_total::text, fee_commission_line::text, fee_works_line::text,
              fee_advance::text, fee_final::text, totals->'eligibility'->>'mode' as eligibility, valid_until,
              totals->'fee'->'parts' as parts
         from sales.quotes where id = $1`,
      [o.current_quote_id],
    );
    const r = rows[0];
    if (r) {
      const parts = Array.isArray(r.parts) ? r.parts : null;
      const base = (group: string) =>
        (parts ?? [])
          .filter((p) => p.group === group)
          .reduce((n, p) => n + (Number.isSafeInteger(p.base) ? (p.base as number) : 0), 0);
      quote = {
        id: r.id,
        version: r.version,
        componentsSum: whole(r.components_sum, "components_sum"),
        outsideScaleSum: whole(r.outside_scale_sum, "outside_scale_sum"),
        purchaseLimit: whole(r.purchase_limit, "purchase_limit"),
        reserveBp: r.reserve_bp,
        reserveSum: whole(r.reserve_sum, "reserve_sum"),
        feeTotal: whole(r.fee_total, "fee_total"),
        feeCommissionLine: whole(r.fee_commission_line, "fee_commission_line"),
        feeWorksLine: whole(r.fee_works_line, "fee_works_line"),
        feeAdvance: whole(r.fee_advance, "fee_advance"),
        feeFinal: whole(r.fee_final, "fee_final"),
        eligibility: r.eligibility,
        validUntil: r.valid_until,
        ...(parts === null ? {} : { pcBase: base("pc"), mountBase: base("mount") }),
      };
    }
  }

  const { rows: resolved } = await q.query<{ resolved: string | null }>(
    "select objection->>'resolvedAfterSeq' as resolved from sales.commission_reports where order_id = $1 order by version desc limit 1",
    [orderId],
  );
  const resolvedAfterSeq =
    resolved[0]?.resolved === undefined || resolved[0]?.resolved === null ? null : Number(resolved[0].resolved);
  const report = reportStateAsOf(
    journal.map((j) => ({ seq: j.seq, type: j.type })),
    Number.isInteger(resolvedAfterSeq) ? resolvedAfterSeq : null,
  );

  const fund = LEDGER_FUND[e.type];
  let ledger: OrderChangeFacts["ledger"] = [];
  if (fund !== undefined) {
    const { rows } = await q.query<{ amount: string }>(
      "select amount_sum::text as amount from sales.reserve_ledger where order_id = $1 and fund = $2 and amount_sum > 0 order by at",
      [orderId, fund],
    );
    ledger = rows.map((r) => ({ fund, amount: whole(r.amount, "reserve") }));
  }

  const settlement = o.cancel?.settlement;
  const dueBy = typeof settlement?.dueBy === "string" ? new Date(settlement.dueBy) : null;
  const sum = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : 0);
  return {
    number: o.number,
    leadNumber: o.lead_number,
    customerRef: o.customer_id,
    kind: o.kind,
    seq,
    from: e.from_status,
    to: e.to_status,
    event: e.type,
    actor: e.actor_kind,
    at: e.at,
    flags: {
      feePrepaid: o.fee_prepaid,
      fundsReceived: o.funds_received,
      firstOrderMeetingDone: o.first_order_meeting_done,
    },
    quote,
    dates: {
      purchaseNotBefore: o.purchase_not_before,
      reportDueAt: o.report_due_at,
      objectionUntil: o.objection_until,
      refundDueAt: o.refund_due_at,
      warrantyUntil: o.warranty_until,
      podborCreditUntil: o.podbor_credit_until,
    },
    report,
    cancel:
      o.cancel === null || typeof o.cancel.point !== "string"
        ? null
        : {
            point: o.cancel.point,
            reason: typeof o.cancel.reason === "string" ? o.cancel.reason : "",
            settlement: {
              feeEarned: sum(settlement?.feeEarned),
              feeToRefund: sum(settlement?.feeToRefund),
              feeToInvoice: sum(settlement?.feeToInvoice),
              fundsToRefund: sum(settlement?.fundsToRefund),
              partsGoTo: typeof settlement?.partsGoTo === "string" ? settlement.partsGoTo : "none",
              dueBy: dueBy !== null && !Number.isNaN(dueBy.getTime()) ? dueBy : null,
            },
          },
    ledger,
  };
}

// ---- payment.confirmed --------------------------------------------------------------------------------------------------

interface PaymentRow {
  id: string;
  order_number: string;
  kind: string;
  direction: "in" | "out";
  method: string;
  amount_sum: string;
  status: string;
  fiscal_receipt_no: string | null;
  bank_doc_no: string | null;
  occurred_at: Date | null;
  confirmed_at: Date | null;
  payer_is_customer: boolean;
  reversal_of: string | null;
  created_at: Date;
}

const PAYMENT_SQL = `select p.id, o.number as order_number, p.kind, p.direction, p.method, p.amount_sum::text, p.status,
       p.fiscal_receipt_no, p.bank_doc_no, p.occurred_at, p.confirmed_at, p.payer_is_customer, p.reversal_of, p.created_at
  from sales.payments p join sales.orders o on o.id = p.order_id where p.id = $1`;

/**
 * A confirmed payment as `payment.confirmed`. A reversal row of the platform carries a negative sum, which the CRM does not take:
 * a full reversal is sent as the void of the payment it reverses. A partial reversal has no place in the CRM yet and is not sent.
 */
export async function loadPaymentFacts(db: Db, paymentId: string): Promise<PaymentFacts | null> {
  const { rows } = await db.$client.query<PaymentRow>(PAYMENT_SQL, [paymentId]);
  const p = rows[0];
  if (p?.status !== "confirmed") return null;
  const amount = whole(p.amount_sum, "amount_sum");
  const toFacts = (row: PaymentRow, status: "confirmed" | "void", reversalOf: string | null): PaymentFacts => ({
    paymentId: row.id,
    orderNumber: row.order_number,
    kind: row.kind,
    direction: row.direction,
    method: row.method,
    amountSum: Math.abs(whole(row.amount_sum, "amount_sum")),
    status,
    fiscalReceiptNo: row.fiscal_receipt_no,
    bankDocNo: row.bank_doc_no,
    occurredAt: row.occurred_at ?? row.created_at,
    confirmedAt: row.confirmed_at,
    payerIsCustomer: row.payer_is_customer,
    reversalOf,
  });
  if (p.reversal_of === null) return amount > 0 ? toFacts(p, "confirmed", null) : null;
  const { rows: originals } = await db.$client.query<PaymentRow>(PAYMENT_SQL, [p.reversal_of]);
  const original = originals[0];
  if (!original || Math.abs(amount) !== whole(original.amount_sum, "amount_sum")) return null;
  return toFacts({ ...original, occurred_at: p.occurred_at ?? original.occurred_at }, "void", p.id);
}

// ---- purchase.recorded --------------------------------------------------------------------------------------------------

export async function loadPurchaseFacts(db: Db, purchaseId: string): Promise<PurchaseFacts | null> {
  const { rows } = await db.$client.query<{
    id: string;
    order_id: string;
    order_number: string;
    qty: number;
    amount_sum: string;
    refund_of: string | null;
    paid_via: string;
    receipt_kind: string;
    receipt_no: string | null;
    esf_no: string | null;
    esf_due: string | null;
    discount_sum: string;
    bonus_note: string | null;
    serials: string[] | null;
    vendor_warranty_months: number | null;
    vendor_warranty_until: string | null;
    bought_at: Date;
    brand: string | null;
    model: string | null;
    category_code: string | null;
    vendor_name: string | null;
    purchase_limit: string | null;
  }>(
    `select p.id, p.order_id, o.number as order_number, p.qty, p.amount_sum::text, p.refund_of, p.paid_via, p.receipt_kind,
            p.receipt_no, p.esf_no, p.esf_due::text as esf_due, p.discount_sum::text, p.bonus_note, p.serials,
            p.vendor_warranty_months, p.vendor_warranty_until::text as vendor_warranty_until, p.bought_at,
            pr.brand, pr.model, pr.category_code, v.name as vendor_name, qt.purchase_limit::text as purchase_limit
       from sales.purchases p
       join sales.orders o on o.id = p.order_id
       left join catalog.products pr on pr.id = p.product_id
       left join pricing.vendors v on v.id = p.vendor_id
       left join sales.quotes qt on qt.id = o.current_quote_id
      where p.id = $1`,
    [purchaseId],
  );
  const p = rows[0];
  // A return to a shop (a negative purchase) is not a receipt: the CRM keeps the receipts only.
  if (!p || p.refund_of !== null || whole(p.amount_sum, "amount_sum") < 0) return null;
  const money = await sales.orderMoney(db, p.order_id);
  return {
    purchaseId: p.id,
    orderNumber: p.order_number,
    title: [p.brand, p.model].filter((x): x is string => typeof x === "string" && x !== "").join(" ") || "Позиция",
    categoryCode: p.category_code,
    vendorName: p.vendor_name ?? "",
    qty: p.qty,
    amountSum: whole(p.amount_sum, "amount_sum"),
    paidVia: p.paid_via,
    receiptKind: p.receipt_kind,
    receiptNo: p.receipt_no,
    esfNo: p.esf_no,
    esfDue: p.esf_due,
    discountSum: whole(p.discount_sum, "discount_sum"),
    bonusNote: p.bonus_note,
    serials: p.serials ?? [],
    vendorWarrantyMonths: p.vendor_warranty_months,
    vendorWarrantyUntil: p.vendor_warranty_until,
    boughtAt: p.bought_at,
    totals: {
      receiptsTotal: money.receiptsTotal,
      fundsReceived: money.fundsReceived,
      purchaseLimit: whole(p.purchase_limit, "purchase_limit"),
    },
  };
}

// ---- warranty.case_opened -----------------------------------------------------------------------------------------------

export async function loadWarrantyFacts(db: Db, caseId: string): Promise<WarrantyFacts | null> {
  const { rows } = await db.$client.query<{
    number: string;
    order_number: string;
    purchase_id: string | null;
    opened_at: Date;
    channel: string | null;
    description: string;
    status: string;
    due_reply: Date | null;
    due_diagnosis: Date | null;
    due_loaner: Date | null;
    due_fix: Date | null;
  }>(
    `select c.number, o.number as order_number, c.purchase_id, c.opened_at, c.channel, c.description, c.status,
            c.due_reply, c.due_diagnosis, c.due_loaner, c.due_fix
       from sales.warranty_cases c join sales.orders o on o.id = c.order_id where c.id = $1`,
    [caseId],
  );
  const c = rows[0];
  if (!c) return null;
  return {
    number: c.number,
    orderNumber: c.order_number,
    purchaseId: c.purchase_id,
    openedAt: c.opened_at,
    channel: c.channel,
    summary: c.description,
    status: c.status,
    dueReply: c.due_reply,
    dueDiagnosis: c.due_diagnosis,
    dueLoaner: c.due_loaner,
    dueFix: c.due_fix,
  };
}
