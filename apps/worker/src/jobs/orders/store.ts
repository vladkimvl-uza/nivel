// What the jobs about the terms of orders read from the database with the rights of nivel_worker (SELECT on the sales tables
// without the address of a customer). The status of an order is never written here: only `orders.dispatch` as the system does it.
import type { Db } from "@nivel/db";
import type { OrderStatus } from "@nivel/domain/order";

export interface OrderFacts {
  id: string;
  number: string;
  status: OrderStatus;
  customerId: string;
  feePrepaid: boolean;
  fundsReceived: boolean;
  objectionUntil: Date | null;
  /** The target of the report (24 hours after the purchases); the latest term is a day later. */
  reportDueAt: Date | null;
  handedOverAt: Date | null;
}

export interface UnansweredLead {
  id: string;
  number: string;
  createdAt: Date;
}

export interface OrdersStore {
  /** Orders whose report is out, whose window of objections has ended and which nobody has accepted since the report. */
  deemedCandidates(now: Date, limit: number): Promise<string[]>;
  /** Orders with an estimate sent whose quote is valid until a moment before `now`. */
  expiryCandidates(now: Date, limit: number): Promise<string[]>;
  order(orderId: string): Promise<OrderFacts | null>;
  /** `valid_until` of the current quote of the order. */
  quoteValidUntil(orderId: string): Promise<Date | null>;
  /** True when a refund of the order (the remainder, or a refund of a cancellation) is expected and not confirmed yet. */
  refundOpen(orderId: string): Promise<boolean>;
  /** New requests nobody has answered, from the last week, that have no reminder yet. */
  unansweredLeads(now: Date, limit: number): Promise<UnansweredLead[]>;
}

export function createPgOrdersStore(db: Db): OrdersStore {
  const q = db.$client;
  return {
    async deemedCandidates(now, limit) {
      const { rows } = await q.query<{ id: string }>(
        `select o.id from sales.orders o
          where o.status = 'report_sent'
            and o.objection_until is not null and o.objection_until < $1
            and not exists (
              select 1 from sales.order_events e
               where e.order_id = o.id
                 and e.event->>'type' in ('REPORT_ACCEPTED', 'REPORT_DEEMED_ACCEPTED')
                 and e.seq > coalesce((select max(s.seq) from sales.order_events s
                                        where s.order_id = o.id and s.event->>'type' = 'SEND_REPORT'), 0))
          order by o.objection_until
          limit $2`,
        [now, limit],
      );
      return rows.map((r) => r.id);
    },

    async expiryCandidates(now, limit) {
      const { rows } = await q.query<{ id: string }>(
        `select o.id from sales.orders o join sales.quotes qt on qt.id = o.current_quote_id
          where o.status = 'estimate_sent' and qt.valid_until is not null and qt.valid_until < $1
          order by qt.valid_until
          limit $2`,
        [now, limit],
      );
      return rows.map((r) => r.id);
    },

    async order(orderId) {
      const { rows } = await q.query<{
        id: string;
        number: string;
        status: OrderStatus;
        customer_id: string;
        fee_prepaid: boolean;
        funds_received: boolean;
        objection_until: Date | null;
        report_due_at: Date | null;
        handed_over_at: Date | null;
      }>(
        `select id, number, status, customer_id, fee_prepaid, funds_received, objection_until, report_due_at, handed_over_at
           from sales.orders where id = $1`,
        [orderId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        number: r.number,
        status: r.status,
        customerId: r.customer_id,
        feePrepaid: r.fee_prepaid,
        fundsReceived: r.funds_received,
        objectionUntil: r.objection_until,
        reportDueAt: r.report_due_at,
        handedOverAt: r.handed_over_at,
      };
    },

    async quoteValidUntil(orderId) {
      const { rows } = await q.query<{ valid_until: Date | null }>(
        "select qt.valid_until from sales.orders o join sales.quotes qt on qt.id = o.current_quote_id where o.id = $1",
        [orderId],
      );
      return rows[0]?.valid_until ?? null;
    },

    async refundOpen(orderId) {
      const { rows } = await q.query(
        "select 1 from sales.payments where order_id = $1 and kind in ('remainder_refund', 'fee_refund', 'funds_refund') and status = 'expected' limit 1",
        [orderId],
      );
      return rows.length > 0;
    },

    async unansweredLeads(now, limit) {
      const { rows } = await q.query<{ id: string; number: string; created_at: Date }>(
        `select l.id, l.number, l.created_at from sales.leads l
          where l.status = 'new' and l.first_response_at is null
            and l.created_at <= $1 and l.created_at > $1::timestamptz - interval '7 days'
            and not exists (select 1 from ops.outbox b where b.dedupe_key = 'lead:' || l.id::text || ':no_answer_15m')
          order by l.created_at
          limit $2`,
        [now, limit],
      );
      return rows.map((r) => ({ id: r.id, number: r.number, createdAt: r.created_at }));
    },
  };
}
