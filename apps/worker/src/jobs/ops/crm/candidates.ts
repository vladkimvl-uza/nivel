// What is new for the CRM: things of the last three days that have no key `crm:...` in ops.outbox yet. The outbox is the memory
// (the unique key of a row is the guard against a second queueing); a thing older than three days is not sent: the CRM is kept by
// hand until the platform feeds it, and the first run of the worker must not pour the whole past into the book.
// Each kind waits a little after the thing was made, for what the platform adds after it: the reserve of an event is booked a
// moment after the commit (ledger.append), a receipt lands with the event of the journal.
import type { Db } from "@nivel/db";
import type { CrmRef } from "./sync.ts";

const WINDOW = "3 days";
const LIMIT = 100;

export function createPgCandidates(db: Db): (now: Date) => Promise<CrmRef[]> {
  const q = db.$client;
  return async (now) => {
    const out: CrmRef[] = [];

    const leads = await q.query<{ id: string }>(
      `select l.id from sales.leads l
        where l.created_at > $1::timestamptz - interval '${WINDOW}' and l.created_at <= $1::timestamptz - interval '60 seconds'
          and not exists (select 1 from ops.outbox b where b.dedupe_key = 'crm:lead:' || l.id::text)
        order by l.created_at limit ${LIMIT}`,
      [now],
    );
    for (const r of leads.rows) out.push({ type: "lead.created", ref: r.id, dedupeKey: `crm:lead:${r.id}` });

    // The journal of the orders; the reserve of HANDOVER and REMAINDER_SETTLED is booked within a minute, so the event waits 90 seconds.
    const events = await q.query<{ order_id: string; seq: number }>(
      `select e.order_id, e.seq from sales.order_events e
        where e.at > $1::timestamptz - interval '${WINDOW}' and e.at <= $1::timestamptz - interval '90 seconds'
          and not exists (select 1 from ops.outbox b where b.dedupe_key = 'crm:order:' || e.order_id::text || ':' || e.seq::text)
        order by e.at, e.seq limit ${LIMIT}`,
      [now],
    );
    for (const r of events.rows) {
      out.push({
        type: "order.status_changed",
        ref: r.order_id,
        seq: r.seq,
        dedupeKey: `crm:order:${r.order_id}:${r.seq}`,
      });
    }

    const payments = await q.query<{ id: string }>(
      `select p.id from sales.payments p
        where p.status = 'confirmed' and p.confirmed_at > $1::timestamptz - interval '${WINDOW}'
          and p.confirmed_at <= $1::timestamptz - interval '30 seconds'
          and not exists (select 1 from ops.outbox b where b.dedupe_key = 'crm:payment:' || p.id::text)
        order by p.confirmed_at limit ${LIMIT}`,
      [now],
    );
    for (const r of payments.rows) out.push({ type: "payment.confirmed", ref: r.id, dedupeKey: `crm:payment:${r.id}` });

    const purchases = await q.query<{ id: string }>(
      `select p.id from sales.purchases p
        where p.refund_of is null and p.amount_sum > 0
          and p.bought_at > $1::timestamptz - interval '${WINDOW}' and p.bought_at <= $1::timestamptz - interval '30 seconds'
          and not exists (select 1 from ops.outbox b where b.dedupe_key = 'crm:purchase:' || p.id::text)
        order by p.bought_at limit ${LIMIT}`,
      [now],
    );
    for (const r of purchases.rows)
      out.push({ type: "purchase.recorded", ref: r.id, dedupeKey: `crm:purchase:${r.id}` });

    const cases = await q.query<{ id: string }>(
      `select c.id from sales.warranty_cases c
        where c.opened_at > $1::timestamptz - interval '${WINDOW}' and c.opened_at <= $1::timestamptz - interval '30 seconds'
          and not exists (select 1 from ops.outbox b where b.dedupe_key = 'crm:warranty:' || c.id::text)
        order by c.opened_at limit ${LIMIT}`,
      [now],
    );
    for (const r of cases.rows)
      out.push({ type: "warranty.case_opened", ref: r.id, dedupeKey: `crm:warranty:${r.id}` });

    return out;
  };
}
