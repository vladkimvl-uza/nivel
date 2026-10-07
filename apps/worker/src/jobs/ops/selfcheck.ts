// ops.selfcheck (ARCHITECTURE 9, 10.3): every ten minutes the worker looks at what can stop the business without a sound: the age of the last
// backup (over 26 hours), the disk (over 80 %), the certificate (under 14 days), a queue that stands for ten minutes, the outbox
// that does not go out, and in the webhook mode the last error of the webhook. A check that fails writes an alert into the outbox
// (a message to the owner's group), once in six hours for one check; a check the runtime cannot look at is "unknown", never an alarm.
import type { ops } from "@nivel/db/repos";
import { isoDateInTashkent, tashkentTime } from "@nivel/domain/calendar";
import type { Logger } from "pino";
import { sanitizeMessage } from "../../queues/failures.ts";
import type { Probes } from "../../queues/runtime.ts";

export const SELFCHECK_LIMITS = {
  backupMaxHours: 26,
  diskMaxPercent: 80,
  certMinDays: 14,
  stallSeconds: 600,
  webhookErrorWindowMs: 15 * 60_000,
} as const;

const PRIORITY = 8;
const BLOCK_HOURS = 6;

export interface SelfcheckDeps {
  now(): Date;
  log: Logger;
  probes: Probes;
  /** Queues of pg-boss whose oldest ready job has waited more than `seconds`. */
  stalledQueues(seconds: number): Promise<{ queue: string; seconds: number }[]>;
  /** How long the oldest due row of the outbox has waited, `null` when no row is due. */
  outboxStalledSeconds(): Promise<number | null>;
  /** The last error of the webhook of the bot; `null` outside the webhook mode or without a token. */
  webhook: (() => Promise<{ lastErrorDate: number | null; lastErrorMessage: string | null }>) | null;
  enqueue(input: ops.OutboxInput): Promise<unknown>;
}

export type CheckState = "ok" | "alert" | "unknown";
export interface CheckResult {
  check: string;
  state: CheckState;
  detail?: string;
}

type Outcome = { state: "ok" } | { state: "alert"; detail: string } | { state: "unknown"; detail?: string };

const minutes = (seconds: number): number => Math.round(seconds / 60);

export async function runSelfcheck(deps: SelfcheckDeps): Promise<CheckResult[]> {
  const now = deps.now();
  const results: CheckResult[] = [];

  const run = async (check: string, fn: () => Promise<Outcome>): Promise<void> => {
    let outcome: Outcome;
    try {
      outcome = await fn();
    } catch (error) {
      deps.log.warn({ check, err: sanitizeMessage(error) }, "selfcheck: the check could not be made");
      results.push({ check, state: "unknown", detail: sanitizeMessage(error) });
      return;
    }
    results.push({ check, ...outcome });
    if (outcome.state === "alert") await alert(deps, now, check, outcome.detail);
  };

  await run("backup_age", async () => {
    const hours = await deps.probes.backupAgeHours();
    if (hours === null) return { state: "unknown" };
    if (hours > SELFCHECK_LIMITS.backupMaxHours) {
      return { state: "alert", detail: Number.isFinite(hours) ? `${Math.floor(hours)} ч` : "копия не найдена" };
    }
    return { state: "ok" };
  });

  await run("disk", async () => {
    const used = await deps.probes.diskUsedPercent();
    if (used === null) return { state: "unknown" };
    return used > SELFCHECK_LIMITS.diskMaxPercent
      ? { state: "alert", detail: `${Math.round(used)} %` }
      : { state: "ok" };
  });

  await run("certificate", async () => {
    const days = await deps.probes.certDaysLeft();
    if (days === null) return { state: "unknown" };
    return days < SELFCHECK_LIMITS.certMinDays ? { state: "alert", detail: `${days} дн.` } : { state: "ok" };
  });

  await run("queue_stalled", async () => {
    const stalled = await deps.stalledQueues(SELFCHECK_LIMITS.stallSeconds);
    if (stalled.length === 0) return { state: "ok" };
    return { state: "alert", detail: stalled.map((s) => `${s.queue}: ${minutes(s.seconds)} мин`).join(", ") };
  });

  await run("outbox_stalled", async () => {
    const seconds = await deps.outboxStalledSeconds();
    if (seconds === null || seconds <= SELFCHECK_LIMITS.stallSeconds) return { state: "ok" };
    return { state: "alert", detail: `${minutes(seconds)} мин` };
  });

  if (deps.webhook !== null) {
    const info = deps.webhook;
    await run("webhook", async () => {
      const w = await info();
      if (w.lastErrorDate === null) return { state: "ok" };
      const ageMs = now.getTime() - w.lastErrorDate * 1000;
      if (ageMs > SELFCHECK_LIMITS.webhookErrorWindowMs) return { state: "ok" };
      return { state: "alert", detail: sanitizeMessage(w.lastErrorMessage ?? "ошибка без текста", 200) };
    });
  }
  return results;
}

async function alert(deps: SelfcheckDeps, now: Date, check: string, detail: string): Promise<void> {
  const block = Math.floor(tashkentTime(now).hour / BLOCK_HOURS);
  await deps.enqueue({
    kind: "telegram_message",
    dedupeKey: `ops:alert:${check}:${isoDateInTashkent(now)}:${block}`,
    priority: PRIORITY,
    payload: { target: "group", templateKey: "ops.alert", lang: "ru", params: { check, detail } },
  });
}
