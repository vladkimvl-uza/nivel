// What the worker leaves behind when a job fails for good (ARCHITECTURE 9, 10.3): one row of ops.app_errors per kind of
// failure, counted, and one alert a day to the owner's group. The table keeps no personal data, so every text is cleaned
// before it is written.
import { createHash } from "node:crypto";
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";

const MAX_MESSAGE = 500;
/** How much of a raw text the masks may look at: a row of the outbox may carry a name of hundreds of kilobytes (no ReDoS). */
const RAW_LOOKAHEAD = 4;

const MASKS: readonly [RegExp, string][] = [
  // the token of a bot: <digits>:<35 letters, digits, - and _>
  [/\b\d{6,20}:[A-Za-z0-9_-]{30,}\b/g, "<token>"],
  // every part has a bound, so the time stays linear in the text however long a run of letters is
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g, "<email>"],
  // a phone number: + and 9 to 15 digits with the usual separators
  [/\+\d[\d\s().-]{7,17}\d/g, "<phone>"],
  // a card number: four groups of four digits
  [/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g, "<card>"],
  // any other long run of digits (ids, accounts)
  [/\b\d{9,}\b/g, "<num>"],
];

/** The text of an error as the table may keep it: no phone, card, mail or token, a few hundred characters at most. */
export function sanitizeMessage(error: unknown, limit = MAX_MESSAGE): string {
  let text: string;
  if (error instanceof Error) text = error.message;
  else if (typeof error === "string") text = error;
  else if (error === undefined || error === null) text = "";
  else {
    try {
      text = JSON.stringify(error) ?? "";
    } catch {
      text = String(error);
    }
  }
  if (text.trim() === "") return "unknown error";
  // Cut first, mask after: what the limit drops is never looked at, and the masks stay fast on any input.
  let out = text.length > limit * RAW_LOOKAHEAD ? text.slice(0, limit * RAW_LOOKAHEAD) : text;
  for (const [re, mask] of MASKS) out = out.replace(re, mask);
  return out.length > limit ? `${out.slice(0, limit - 1)}…` : out;
}

/** The stack with the same cleaning; the first lines are enough to find the place. */
export function sanitizeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  return sanitizeMessage(error.stack.split("\n").slice(0, 8).join("\n"), 2000);
}

/**
 * The key of a kind of failure: the queue, the class of the error and its message with ids and numbers blurred, so that
 * "order <uuid> refused 4012345 sums" is one row, not one row for every order.
 */
export function fingerprintOf(queue: string, error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const shape = sanitizeMessage(error, 300)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "#");
  return createHash("sha256").update(`${queue}\n${name}\n${shape}`).digest("hex").slice(0, 16);
}

/** The day of an alert in the calendar of the business (Asia/Tashkent): the same failure is told once a day. */
export function alertDayKey(at: Date): string {
  return isoDateInTashkent(at);
}

// ---- the database part -----------------------------------------------------------------------------------------------

export interface FailureInfo {
  queue: string;
  jobId?: string | undefined;
  /** How many times the job has run when it gave up. */
  attempts: number;
  error: unknown;
}

/** Where a job that has failed for good is written down; the real one is `createFailureSink`, the tests bring their own. */
export interface FailureSink {
  recordFinal(info: FailureInfo): Promise<{ count: number; fingerprint: string }>;
}

/**
 * After the last attempt: a row of `ops.app_errors` (counted by fingerprint) and, once a day for one fingerprint, a message to
 * the owner's group through the outbox. The alert is queued, not sent, so a Telegram outage does not hide the failure.
 */
export function createFailureSink(deps: { db: Db; now(): Date }): FailureSink {
  return {
    async recordFinal(info) {
      const fingerprint = fingerprintOf(info.queue, info.error);
      const message = sanitizeMessage(info.error);
      const stack = sanitizeStack(info.error);
      const { count } = await ops.recordAppError(deps.db, {
        app: "worker",
        fingerprint,
        message: `[${info.queue}] ${message}`,
        ...(stack === undefined ? {} : { stack }),
      });
      await ops.enqueueOutbox(deps.db, {
        kind: "telegram_message",
        dedupeKey: `ops:error:${fingerprint}:${alertDayKey(deps.now())}`,
        priority: 5,
        payload: {
          target: "group",
          templateKey: "ops.job_failed",
          lang: "ru",
          params: { queue: info.queue, attempts: info.attempts, count, message },
        },
      });
      return { count, fingerprint };
    },
  };
}
