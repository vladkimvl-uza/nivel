// threshold.check (ARCHITECTURE 4.8, 9): the registration threshold of the VAT payer. At 06:00 and after every payment or receipt
// (the outbox job of the services) the worker takes `thresholdStatus` of the domain through `threshold.status`, keeps the snapshot
// of the day (the row of the day is rewritten, one a day), and tells the owner of every level of 60/70/80/90/100 % the share has
// crossed and, once, that the forecast is over the plan. The dedupe key makes an alert go once for each level and year.
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import type { ThresholdStatus } from "@nivel/domain/threshold";
import type { Logger } from "pino";

const PRIORITY = 5;

export interface ThresholdDeps {
  now(): Date;
  log: Logger;
  /** `threshold.status` of the services (the worker may read the money of the whole business). */
  status(year: number): Promise<ThresholdStatus>;
  /** The plan of the year (`money.threshold.planCap`), `null` when the owner has set none. */
  planCap(): Promise<number | null>;
  saveSnapshot(snapshot: ops.ThresholdSnapshotInput): Promise<void>;
  enqueue(input: ops.OutboxInput): Promise<unknown>;
}

const isDuplicate = (answer: unknown): boolean =>
  typeof answer === "object" && answer !== null && (answer as { duplicate?: unknown }).duplicate === true;

/** `alerts` are the levels the share has crossed; `queued` are those this run put into the outbox (the others had their key already). */
export async function handleThresholdCheck(
  deps: ThresholdDeps,
): Promise<{ alerts: (number | "plan")[]; queued: (number | "plan")[] }> {
  const now = deps.now();
  const asOf = isoDateInTashkent(now);
  const year = Number(asOf.slice(0, 4));
  const status = await deps.status(year);
  const planCap = await deps.planCap();

  await deps.saveSnapshot({
    year,
    asOf,
    dealsSum: status.volume,
    committedSum: status.committed,
    limitSum: status.limit,
    ...(planCap === null ? {} : { planCapSum: planCap }),
    shareBp: status.shareBp,
  });

  const alerts: (number | "plan")[] = [];
  const queued: (number | "plan")[] = [];
  for (const level of status.crossedAlerts) {
    const answer = await deps.enqueue({
      kind: "telegram_message",
      dedupeKey: `threshold:${year}:${level}`,
      priority: PRIORITY,
      payload: {
        target: "group",
        templateKey: "threshold.alert",
        lang: "ru",
        params: { year, levelBp: level, shareBp: status.shareBp, volume: status.volume, limit: status.limit },
      },
    });
    alerts.push(level);
    if (!isDuplicate(answer)) queued.push(level);
  }
  if (status.overPlanCap && planCap !== null) {
    const answer = await deps.enqueue({
      kind: "telegram_message",
      dedupeKey: `threshold:${year}:plan`,
      priority: PRIORITY,
      payload: {
        target: "group",
        templateKey: "threshold.plan",
        lang: "ru",
        params: { year, planCap, projectedShareBp: status.projectedShareBp },
      },
    });
    alerts.push("plan");
    if (!isDuplicate(answer)) queued.push("plan");
  }
  const already = alerts.filter((a) => !queued.includes(a));
  deps.log.info({ year, shareBp: status.shareBp, queued, already }, "threshold.check");
  return { alerts, queued };
}

/** The plan of the owner from the setting `money.threshold` (a whole sum), or `null`. */
export async function readPlanCap(db: Db): Promise<number | null> {
  const value = (await ops.getSetting(db, "money.threshold"))?.value;
  const cap = typeof value === "object" && value !== null ? (value as { planCap?: unknown }).planCap : undefined;
  return typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0 ? cap : null;
}
