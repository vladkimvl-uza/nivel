// The load of the workshop (BUILD_PLAN WP-07, DECISIONS R-8): a free window exists when fewer than two orders are in
// work and no order of the full cycle (from 6.7 million) waits in the queue. Only then an estimate of 4.5-6.7 million is
// eligible. Needs the right to read orders (the site passes `false` instead).
import type { Executor } from "@nivel/db/repos";
import { dsl } from "./dsl.ts";

/** Statuses of an order that takes the hands of the owner: from the first purchase to the handover. */
export const IN_WORK_STATUSES = [
  "purchasing",
  "report_due",
  "report_sent",
  "settled",
  "assembling",
  "testing",
  "ready",
  "delivering",
] as const;

export const IN_WORK_LIMIT = 2;

export async function freeWindowAvailable(ex: Executor, settings: { minFullCyclePc: number }): Promise<boolean> {
  const { sql } = dsl(ex);
  const { rows } = await ex.execute<{ in_work: string; big_waiting: string }>(sql`
    select
      (select count(*) from sales.orders where status in ${[...IN_WORK_STATUSES]})::text as in_work,
      (select count(*) from sales.orders o join sales.quotes q on q.id = o.current_quote_id
        where o.status = 'accepted' and q.components_sum >= ${settings.minFullCyclePc})::text as big_waiting`);
  const r = rows[0];
  return Number(r?.in_work ?? 0) < IN_WORK_LIMIT && Number(r?.big_waiting ?? 0) === 0;
}
