// The site reads orders only through the customer views `sales.v_customer_order_*` (DATA-MAP 2): the role cannot read
// sales.orders, quotes, payments, purchases, the journal or the reports. The views show the orders of ALL customers, so
// every read here names the customer of the session in its WHERE clause and the caller must pass the customer id of
// the checked session, never one from the request (DATA-MAP 2, "предел защиты").
import { type Executor, ops } from "@nivel/db/repos";
import { sum } from "@nivel/domain/money";
import { readStoredTotals } from "../quotes/stored.ts";
import { dsl } from "./dsl.ts";
import type { Runtime } from "./runtime.ts";
import {
  loadOffers,
  loadReserves,
  type OfferChoice,
  type OrderRow,
  type SnapshotInputs,
  type SnapshotQuote,
} from "./snapshot.ts";
import { asDate } from "./validate.ts";

type HeadRow = {
  order_id: string;
  number: string;
  customer_id: string;
  kind: OrderRow["kind"];
  status: OrderRow["status"];
  fee_prepaid: boolean;
  funds_received: boolean;
  accepted_at: Date | null;
  report_due_at: Date | null;
  objection_until: Date | null;
  refund_due_at: Date | null;
  handed_over_at: Date | null;
  warranty_until: Date | null;
  created_at: Date;
};

/** The order as the view shows it, in the shape of the row of the table; the columns the view hides are at their neutral values. */
export async function webHead(ex: Executor, orderId: string): Promise<OrderRow | null> {
  const { sql } = dsl(ex);
  const { rows } = await ex.execute<HeadRow>(sql`
    select order_id, number, customer_id, kind, status, fee_prepaid, funds_received, accepted_at, report_due_at,
           objection_until, refund_due_at, handed_over_at, warranty_until, created_at
      from sales.v_customer_order_status where order_id = ${orderId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.order_id,
    number: r.number,
    leadId: null,
    customerId: r.customer_id,
    contractScheme: "commission",
    kind: r.kind,
    slot: "regular",
    complexBuild: false,
    status: r.status,
    feePrepaid: r.fee_prepaid,
    fundsReceived: r.funds_received,
    fundsReceivedAt: null,
    purchaseNotBefore: null,
    firstOrderMeetingDone: false,
    currentQuoteId: null,
    offerVersionUzId: null,
    offerVersionRuId: null,
    acceptedAt: asDate(r.accepted_at),
    reportDueAt: asDate(r.report_due_at),
    objectionUntil: asDate(r.objection_until),
    refundDueAt: asDate(r.refund_due_at),
    handedOverAt: asDate(r.handed_over_at),
    warrantyUntil: asDate(r.warranty_until),
    cancel: null,
    documentedLossesSum: 0,
    podborCreditUntil: null,
    tgTopicId: null,
    assignee: null,
    createdAt: asDate(r.created_at) as Date,
    updatedAt: asDate(r.created_at) as Date,
  };
}

const STARTED = [
  "accepted",
  "purchasing",
  "report_due",
  "report_sent",
  "settled",
  "assembling",
  "testing",
  "ready",
  "delivering",
  "handed_over",
  "closed",
];

/** The facts of the snapshot that the views give. What they hide (the journal, the reports, the ledger) is neutral. */
export async function loadWebInputs(
  rt: Runtime,
  ex: Executor,
  order: OrderRow,
  now: Date,
): Promise<{ inputs: SnapshotInputs; offers: OfferChoice }> {
  const { sql } = dsl(ex);
  const orderId = order.id;
  const { rows: quotes } = await ex.execute<{
    quote_id: string;
    status: string;
    valid_until: Date | null;
    totals: unknown;
    purchase_limit: string;
    fee_total: string;
    fee_advance: string;
    fee_final: string;
    lines: { returnable: string; customerOwned: boolean }[] | null;
  }>(sql`
    select quote_id, status, valid_until, totals, purchase_limit::text, fee_total::text, fee_advance::text, fee_final::text, lines
      from sales.v_customer_order_quotes where order_id = ${orderId} order by version desc limit 1`);
  const q = quotes[0];
  const quote: SnapshotQuote | undefined = q
    ? {
        id: q.quote_id,
        status: q.status,
        validUntil: asDate(q.valid_until),
        stored: readStoredTotals(q.totals),
        purchaseLimit: Number(q.purchase_limit),
        feeTotal: Number(q.fee_total),
        advance: Number(q.fee_advance),
        final: Number(q.fee_final),
        // A quote the customer can see was sent, and a sent quote was checked by hand (CHECK quotes_sent_chk).
        manuallyChecked: true,
        hasNonReturnable: (q.lines ?? []).some((l) => l.returnable === "no" && !l.customerOwned),
      }
    : undefined;

  const { rows: sums } = await ex.execute<{ funds: string; refunded: string; spent: string; others: string }>(sql`
    select
      coalesce((select sum(amount_sum) from sales.v_customer_order_payments
                 where order_id = ${orderId} and status = 'confirmed' and kind in ('purchase_funds', 'purchase_topup')), 0)::text as funds,
      coalesce((select sum(amount_sum) from sales.v_customer_order_payments
                 where order_id = ${orderId} and status = 'confirmed' and kind in ('remainder_refund', 'funds_refund')), 0)::text as refunded,
      coalesce((select sum(amount_sum) from sales.v_customer_order_purchases where order_id = ${orderId}), 0)::text as spent,
      (select count(*) from sales.v_customer_order_status
        where customer_id = ${order.customerId} and order_id <> ${orderId} and status in ${STARTED})::text as others`);
  const s = sums[0];
  const offers = await loadOffers(ex, { uz: null, ru: null });
  const inputs: SnapshotInputs = {
    order: {
      status: order.status,
      kind: order.kind,
      feePrepaid: order.feePrepaid,
      fundsReceived: order.fundsReceived,
      firstOrderMeetingDone: false,
      purchaseNotBefore: null,
    },
    quote,
    money: {
      fundsReceived: sum(Number(s?.funds ?? 0)),
      receiptsTotal: sum(Number(s?.spent ?? 0)),
      refunded: sum(Number(s?.refunded ?? 0)),
      documentedLosses: sum(0),
      hasLimitOverrunConsent: await ops.consentGranted(ex, orderId, "limit_overrun"),
    },
    purchasesComplete: false,
    report: undefined,
    firstOrderOfCustomer: Number(s?.others ?? 0) === 0,
    offer: offers.status,
    appMode: rt.appMode,
    reserves: await loadReserves(ex, now),
  };
  return { inputs, offers };
}
