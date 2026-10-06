// outbox.enqueue (ARCHITECTURE 4.13, 9): the one door to ops.outbox for scenarios that queue a message or a job outside
// of a status change (a status change queues its own messages inside `dispatch`). The relay of the worker sends the
// messages with the throttling of Telegram and runs the jobs; a row with a `dedupe_key` is queued once.
import { type Executor, ops } from "@nivel/db/repos";
import { ValidationError, type ValidationIssue } from "../orders/errors.ts";
import { type Runtime, runtimeOf } from "../orders/runtime.ts";
import { OUTBOX_JOB } from "./contract.ts";

const MAX_PAYLOAD_BYTES = 16_384;
const MAX_KEY = 200;
const TARGETS: readonly string[] = ["customer", "owner_topic", "group"];
/** Sixteen digits in a row (with spaces or dashes): the number of a card. It never travels in a message or a job. */
const CARD_NUMBER = /(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/;

/**
 * Jobs that move money or sign for a person. Only the scenarios queue them, from facts they have checked; this door is
 * open to the bot and the site, whose payload is not to be trusted with a sum.
 */
const RESERVED_JOBS: readonly string[] = [OUTBOX_JOB.LEDGER_APPEND, OUTBOX_JOB.PAYMENT_EXPECT, OUTBOX_JOB.ACT_SIGN];

export type OutboxMessage =
  | { kind: "telegram_message"; payload: { target: string; templateKey: string } & Record<string, unknown> }
  | { kind: "job"; payload: { job: string } & Record<string, unknown> };

export type EnqueueInput = OutboxMessage & {
  /** A second message with the same key is not queued: a repeated request does not repeat the message. */
  dedupeKey?: string;
  /** From -10 (background) to 10 (urgent). */
  priority?: number;
  /** Not before this moment (the reminder 24 hours after the acceptance). */
  sendAfter?: Date;
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function validate(m: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bad = (path: string, code: string, message: string) => issues.push({ path, code, message });
  if (!isObject(m)) return [{ path: "", code: "message_invalid", message: "the message must be an object" }];
  if (m.kind !== "telegram_message" && m.kind !== "job")
    bad("kind", "kind_unknown", "kind must be telegram_message or job");
  if (!isObject(m.payload)) {
    bad("payload", "payload_invalid", "the payload must be an object");
  } else {
    if (m.kind === "telegram_message") {
      if (typeof m.payload.target !== "string" || !TARGETS.includes(m.payload.target)) {
        bad("payload.target", "target_unknown", `the target must be one of ${TARGETS.join(", ")}`);
      }
      if (typeof m.payload.templateKey !== "string" || m.payload.templateKey === "") {
        bad("payload.templateKey", "template_required", "a message names its template");
      }
    }
    if (m.kind === "job" && (typeof m.payload.job !== "string" || m.payload.job === "")) {
      bad("payload.job", "job_required", "a job names itself");
    } else if (m.kind === "job" && RESERVED_JOBS.includes(m.payload.job as string)) {
      bad("payload.job", "job_reserved", `the job ${String(m.payload.job)} is queued by the scenarios only`);
    }
    const text = JSON.stringify(m.payload);
    if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) {
      bad("payload", "payload_too_large", `the payload must not exceed ${MAX_PAYLOAD_BYTES} bytes`);
    }
    if (CARD_NUMBER.test(text)) bad("payload", "card_number", "the number of a card must not travel in a message");
  }
  if (
    m.dedupeKey !== undefined &&
    (typeof m.dedupeKey !== "string" || m.dedupeKey === "" || m.dedupeKey.length > MAX_KEY)
  ) {
    bad("dedupeKey", "key_invalid", `the key must be a text of 1 to ${MAX_KEY} characters`);
  }
  if (
    m.priority !== undefined &&
    (!Number.isInteger(m.priority) || (m.priority as number) < -10 || (m.priority as number) > 10)
  ) {
    bad("priority", "priority_invalid", "the priority must be a whole number from -10 to 10");
  }
  if (m.sendAfter !== undefined && (!(m.sendAfter instanceof Date) || Number.isNaN(m.sendAfter.getTime()))) {
    bad("sendAfter", "date_invalid", "sendAfter must be a valid date");
  }
  return issues;
}

/** Queues a message or a job. With `executor` (the transaction of the caller) it is queued with the change or not at all. */
export async function enqueue(
  message: EnqueueInput,
  opts: { executor?: Executor } = {},
  rt?: Runtime,
): Promise<{ id: string; duplicate: boolean }> {
  const r = runtimeOf(rt);
  const issues = validate(message);
  if (issues.length > 0) throw new ValidationError(issues);
  return ops.enqueueOutbox(opts.executor ?? r.db, {
    kind: message.kind,
    payload: message.payload,
    ...(message.dedupeKey === undefined ? {} : { dedupeKey: message.dedupeKey }),
    ...(message.priority === undefined ? {} : { priority: message.priority }),
    ...(message.sendAfter === undefined ? {} : { sendAfter: message.sendAfter }),
  });
}
