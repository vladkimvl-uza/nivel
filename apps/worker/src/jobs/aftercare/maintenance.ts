// aftercare (ARCHITECTURE 9): at 10:00 the worker reminds the owner of the preventive maintenance of the PCs he has handed over, 6 and
// 12 months after the handover (the calls 7 and 30 days after the handover are jobs of the order calendar, see orders/scheduled.ts).
// A term is told once for an order (the dedupe key) and only while it is fresh: a term that passed more than 45 days ago is left, so
// that the first run of the worker does not wake up every old order.
import type { Db } from "@nivel/db";
import type { ops } from "@nivel/db/repos";
import { addMonthsTashkent } from "@nivel/domain/calendar";
import type { Logger } from "pino";

export const MAINTENANCE_MONTHS = [6, 12] as const;
const FRESH_DAYS = 45;
const DAY_MS = 86_400_000;
const PRIORITY = 1;

export interface Candidate {
  orderId: string;
  orderNumber: string;
  handedOverAt: Date;
}

export interface MaintenanceDeps {
  now(): Date;
  log: Logger;
  /** Orders handed over between 13 and 6 months before `now`. */
  candidates(now: Date): Promise<Candidate[]>;
  enqueue(input: ops.OutboxInput): Promise<{ duplicate: boolean }>;
}

export async function handleMaintenance(deps: MaintenanceDeps): Promise<{ reminded: number }> {
  const now = deps.now();
  let reminded = 0;
  for (const c of await deps.candidates(now)) {
    for (const months of MAINTENANCE_MONTHS) {
      const due = addMonthsTashkent(c.handedOverAt, months).getTime();
      if (now.getTime() < due || now.getTime() - due > FRESH_DAYS * DAY_MS) continue;
      const made = await deps.enqueue({
        kind: "telegram_message",
        dedupeKey: `order:${c.orderId}:maintenance:${months}`,
        priority: PRIORITY,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.maintenance",
          orderId: c.orderId,
          orderNumber: c.orderNumber,
          params: { months },
        },
      });
      if (!made.duplicate) reminded += 1;
    }
  }
  if (reminded > 0) deps.log.info({ reminded }, "aftercare: maintenance reminders");
  return { reminded };
}

export function createPgMaintenanceReader(db: Db): MaintenanceDeps["candidates"] {
  return async (now) => {
    const { rows } = await db.$client.query<{ id: string; number: string; handed_over_at: Date }>(
      `select id, number, handed_over_at from sales.orders
        where status in ('handed_over', 'closed')
          and handed_over_at <= $1::timestamptz - interval '6 months'
          and handed_over_at > $1::timestamptz - interval '14 months'
        order by handed_over_at
        limit 500`,
      [now],
    );
    return rows.map((r) => ({ orderId: r.id, orderNumber: r.number, handedOverAt: r.handed_over_at }));
  };
}
