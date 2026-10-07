// The ESF of a purchase (ARCHITECTURE 9, orders.reminders: "ЭСФ 10 дней"): the electronic invoice of a purchase of the sole proprietor
// is due 10 calendar days after it (`purchases.esf_due`). On that day, and after it, while the status is still `pending`, the owner
// is told once for the purchase.
import type { Db } from "@nivel/db";
import type { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import type { Logger } from "pino";

const PRIORITY = 3;

export interface EsfDue {
  purchaseId: string;
  orderId: string;
  orderNumber: string;
  /** YYYY-MM-DD */
  dueDate: string;
}

export interface EsfDeps {
  now(): Date;
  log: Logger;
  /** Purchases whose ESF is `pending` and due on `today` or in the last 30 days, with no reminder yet. */
  esfDue(today: string): Promise<EsfDue[]>;
  enqueue(input: ops.OutboxInput): Promise<{ duplicate: boolean }>;
}

export async function handleEsfReminders(deps: EsfDeps): Promise<{ reminded: number }> {
  const today = isoDateInTashkent(deps.now());
  let reminded = 0;
  for (const p of await deps.esfDue(today)) {
    const made = await deps.enqueue({
      kind: "telegram_message",
      dedupeKey: `purchase:${p.purchaseId}:esf_due`,
      priority: PRIORITY,
      payload: {
        target: "owner_topic",
        templateKey: "reminder.esf_due",
        orderId: p.orderId,
        orderNumber: p.orderNumber,
        params: { dueDate: p.dueDate },
      },
    });
    if (!made.duplicate) reminded += 1;
  }
  if (reminded > 0) deps.log.info({ reminded }, "orders.reminders: ESF due");
  return { reminded };
}

export function createPgEsfReader(db: Db): EsfDeps["esfDue"] {
  return async (today) => {
    const { rows } = await db.$client.query<{ id: string; order_id: string; number: string; due: string }>(
      `select p.id, p.order_id, o.number, p.esf_due::text as due
         from sales.purchases p join sales.orders o on o.id = p.order_id
        where p.esf_status = 'pending' and p.esf_due <= $1::date and p.esf_due > $1::date - 30
          and not exists (select 1 from ops.outbox b where b.dedupe_key = 'purchase:' || p.id::text || ':esf_due')
        order by p.esf_due
        limit 500`,
      [today],
    );
    return rows.map((r) => ({ purchaseId: r.id, orderId: r.order_id, orderNumber: r.number, dueDate: r.due }));
  };
}
