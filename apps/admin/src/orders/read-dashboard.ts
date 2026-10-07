// The dashboard of the day (ARCHITECTURE 6.3): what waits for the owner. The terms are the ones the automaton and the
// scenarios stored (reportDueAt, refundDueAt, validUntil, esfDue); "late" is a comparison with `now` made by the
// database on the stored instants, nothing is recounted here.
import type { Db } from "@nivel/db";
import type { OrderStatus } from "@nivel/domain/order";

export interface DashboardData {
  newLeads: { id: string; number: string; scope: string; createdAt: Date; waitingMs: number }[];
  estimatesExpiring: { orderId: string; number: string; validUntil: Date; expired: boolean }[];
  reportsDue: { orderId: string; number: string; dueAt: Date | null; late: boolean }[];
  refundsDue: {
    orderId: string;
    number: string;
    kind: string;
    amountSum: number;
    dueAt: Date | null;
    late: boolean;
  }[];
  esfPending: {
    purchaseId: string;
    orderId: string;
    orderNumber: string;
    esfNo: string | null;
    due: string | null;
    late: boolean;
  }[];
  warranty: {
    id: string;
    number: string;
    orderId: string;
    orderNumber: string;
    status: string;
    nextDue: Date | null;
    late: boolean;
  }[];
  active: { status: OrderStatus; count: number }[];
}

const num = (v: unknown): number => Number(v ?? 0);

export async function loadDashboard(db: Db, now: Date): Promise<DashboardData> {
  const at = now.toISOString();
  const q = <T extends object>(text: string, params: unknown[] = [at]) => db.$client.query<T>(text, params);
  const [leads, estimates, reports, refunds, esf, warranty, active] = await Promise.all([
    q<{ id: string; number: string; scope: string; created_at: Date }>(
      `select id, number, scope, created_at from sales.leads
        where status = 'new' and first_response_at is null
        order by created_at limit 20`,
      [],
    ),
    q<{ order_id: string; number: string; valid_until: Date; expired: boolean }>(
      `select o.id as order_id, o.number, qt.valid_until, qt.valid_until < $1::timestamptz as expired
         from sales.orders o join sales.quotes qt on qt.id = o.current_quote_id
        where o.status = 'estimate_sent' and qt.valid_until is not null
        order by qt.valid_until limit 20`,
    ),
    q<{ order_id: string; number: string; due_at: Date | null; late: boolean }>(
      `select o.id as order_id, o.number, o.report_due_at as due_at, coalesce(o.report_due_at < $1::timestamptz, false) as late
         from sales.orders o where o.status = 'report_due'
        order by o.report_due_at nulls last limit 20`,
    ),
    q<{ order_id: string; number: string; kind: string; amount_sum: string; due_at: Date | null; late: boolean }>(
      `select o.id as order_id, o.number, p.kind, p.amount_sum::text as amount_sum, o.refund_due_at as due_at,
              coalesce(o.refund_due_at < $1::timestamptz, false) as late
         from sales.payments p join sales.orders o on o.id = p.order_id
        where p.status = 'expected' and p.kind in ('remainder_refund', 'fee_refund', 'funds_refund')
        order by o.refund_due_at nulls last, p.created_at limit 20`,
    ),
    q<{
      purchase_id: string;
      order_id: string;
      number: string;
      esf_no: string | null;
      esf_due: string | null;
      late: boolean;
    }>(
      `select pu.id as purchase_id, o.id as order_id, o.number, pu.esf_no, pu.esf_due::text as esf_due,
              coalesce(pu.esf_due < ($1::timestamptz at time zone 'Asia/Tashkent')::date, false) as late
         from sales.purchases pu join sales.orders o on o.id = pu.order_id
        where pu.esf_status = 'pending'
        order by pu.esf_due nulls last limit 20`,
    ),
    q<{
      id: string;
      number: string;
      order_id: string;
      order_number: string;
      status: string;
      next_due: Date | null;
      late: boolean;
    }>(
      `select w.id, w.number, o.id as order_id, o.number as order_number, w.status,
              least(w.due_reply, w.due_diagnosis, w.due_fix) as next_due,
              coalesce(least(w.due_reply, w.due_diagnosis, w.due_fix) < $1::timestamptz, false) as late
         from sales.warranty_cases w join sales.orders o on o.id = w.order_id
        where w.status in ('opened', 'diagnosing', 'loaner_issued', 'at_supplier')
        order by next_due nulls last limit 20`,
    ),
    q<{ status: OrderStatus; n: string }>(
      `select status, count(*)::text as n from sales.orders
        where status not in ('closed', 'cancelled', 'podbor_delivered') group by status`,
      [],
    ),
  ]);
  return {
    newLeads: leads.rows.map((r) => ({
      id: r.id,
      number: r.number,
      scope: r.scope,
      createdAt: r.created_at,
      waitingMs: Math.max(0, now.getTime() - r.created_at.getTime()),
    })),
    estimatesExpiring: estimates.rows.map((r) => ({
      orderId: r.order_id,
      number: r.number,
      validUntil: r.valid_until,
      expired: r.expired,
    })),
    reportsDue: reports.rows.map((r) => ({ orderId: r.order_id, number: r.number, dueAt: r.due_at, late: r.late })),
    refundsDue: refunds.rows.map((r) => ({
      orderId: r.order_id,
      number: r.number,
      kind: r.kind,
      amountSum: num(r.amount_sum),
      dueAt: r.due_at,
      late: r.late,
    })),
    esfPending: esf.rows.map((r) => ({
      purchaseId: r.purchase_id,
      orderId: r.order_id,
      orderNumber: r.number,
      esfNo: r.esf_no,
      due: r.esf_due,
      late: r.late,
    })),
    warranty: warranty.rows.map((r) => ({
      id: r.id,
      number: r.number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      status: r.status,
      nextDue: r.next_due,
      late: r.late,
    })),
    active: active.rows.map((r) => ({ status: r.status, count: num(r.n) })),
  };
}
