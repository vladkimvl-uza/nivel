// outbox.relay (ARCHITECTURE 9): ops.outbox to Telegram, with the limits of Telegram, and to the queues of pg-boss. One pass takes
// the rows that are due and settles each of them; a row is never lost and never sent twice by the relay itself:
//  - a message goes to the address the DATABASE has for it (the Telegram id of customers.<customerId>, the topic of the
//    order, the group of the owner in ops.settings), never to the address the payload names (outbox/contract.ts);
//  - without BOT_TOKEN a row is skipped with its reason written on it; a template the worker does not know is skipped too
//    (the texts of the order automaton come with the bot);
//  - the limits are the throttle's: a short wait is waited out here, a long one puts the row back in the outbox;
//  - a job is handed to its queue of pg-boss under the key of the row; `act.sign` is refused, `pdf.render` waits for the flag
//    `feature.pdf` and for the queue of WP-12.
import type { Logger } from "pino";
import type { FailureSink } from "../../queues/failures.ts";
import { sanitizeMessage } from "../../queues/failures.ts";
import type { JobSink, Lang, MessageRenderer, TelegramGateway } from "../../queues/runtime.ts";
import { TelegramError } from "../../queues/telegram.ts";
import type { Throttle } from "../../queues/throttle.ts";
import { OUTBOX_JOB, queueOfJob, REFUSED_JOBS } from "./routes.ts";
import type { OutboxRow, OutboxStore } from "./store.ts";

/** Attempts a row gets before it is `failed` for good. */
export const RELAY_MAX_ATTEMPTS = 5;
/** A wait for the throttle up to this long is waited out inside the pass; a longer one puts the row back. */
export const MAX_INLINE_WAIT_MS = 1500;
/** pdf.render waits this long between looks at the flag and at the queue. */
export const PDF_WAIT_MS = 10 * 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;
const DEFAULT_LIMIT = 10;
export const PDF_FLAG = "feature.pdf";

/** The addresses of the messages, read from the database. */
export interface ChatDirectory {
  /** The chat of a customer and his language, or why there is none. */
  customer(customerId: string): Promise<{ chatId: number; lang: Lang } | { skip: string }>;
  /** The chat id of the group of the owner (ops.settings `telegram.owner_group`), `null` when it is not set. */
  ownerGroup(): Promise<number | null>;
  /** The topic of the order or of the request in the group of the owner, `null` when it has none. */
  topic(ref: { orderId?: string; leadId?: string }): Promise<number | null>;
}

export interface FlagReader {
  isOn(key: string): Promise<boolean>;
}

export interface RelayDeps {
  now(): Date;
  sleep(ms: number): Promise<void>;
  log: Logger;
  store: OutboxStore;
  directory: ChatDirectory;
  flags: FlagReader;
  telegram: TelegramGateway;
  throttle: Throttle;
  renderer: MessageRenderer;
  jobs: JobSink;
  failures: FailureSink;
}

export interface RelayStats {
  claimed: number;
  sent: number;
  deferred: number;
  skipped: number;
  retried: number;
  dead: number;
}

type Outcome =
  | { kind: "sent" }
  | { kind: "skip"; reason: string }
  | { kind: "defer"; ms: number }
  | { kind: "retry"; error: unknown }
  | { kind: "dead"; error: unknown };

const TARGETS = ["customer", "owner_topic", "group"] as const;
type Target = (typeof TARGETS)[number];

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** The pause before the next try of a row that failed `attempts` times: 30 s, 1 min, 2 min, 4 min, up to half an hour. */
export function retryAfterMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts));
}

export async function relayOnce(deps: RelayDeps, opts: { limit?: number } = {}): Promise<RelayStats> {
  const stats: RelayStats = { claimed: 0, sent: 0, deferred: 0, skipped: 0, retried: 0, dead: 0 };
  const rows = await deps.store.claim(opts.limit ?? DEFAULT_LIMIT);
  stats.claimed = rows.length;
  for (const row of rows) {
    let outcome: Outcome;
    try {
      outcome = row.kind === "job" ? await processJob(deps, row) : await processMessage(deps, row);
    } catch (error) {
      outcome = { kind: "retry", error };
    }
    await settle(deps, row, outcome, stats);
  }
  return stats;
}

async function settle(deps: RelayDeps, row: OutboxRow, outcome: Outcome, stats: RelayStats): Promise<void> {
  const { store, log } = deps;
  switch (outcome.kind) {
    case "sent":
      await store.markSent(row.id);
      stats.sent += 1;
      return;
    case "skip":
      await store.skip(row.id, outcome.reason);
      log.warn({ outboxId: row.id, kind: row.kind, reason: outcome.reason }, "outbox row skipped");
      stats.skipped += 1;
      return;
    case "defer":
      await store.defer(row.id, outcome.ms);
      stats.deferred += 1;
      return;
    case "retry": {
      const message = sanitizeMessage(outcome.error);
      const status = await store.retryLater(row.id, message, retryAfterMs(row.attempts), RELAY_MAX_ATTEMPTS);
      stats.retried += 1;
      if (status === "failed") {
        log.error({ outboxId: row.id, kind: row.kind, err: message }, "outbox row failed for good");
        await record(deps, row, RELAY_MAX_ATTEMPTS, outcome.error);
      } else {
        log.warn(
          { outboxId: row.id, kind: row.kind, attempt: row.attempts + 1, err: message },
          "outbox row will be retried",
        );
      }
      return;
    }
    case "dead": {
      const message = sanitizeMessage(outcome.error);
      await store.fail(row.id, message);
      log.error({ outboxId: row.id, kind: row.kind, err: message }, "outbox row refused for good");
      stats.dead += 1;
      await record(deps, row, row.attempts + 1, outcome.error);
      return;
    }
  }
}

async function record(deps: RelayDeps, row: OutboxRow, attempts: number, error: unknown): Promise<void> {
  try {
    await deps.failures.recordFinal({ queue: "outbox.relay", jobId: row.id, attempts, error });
  } catch (recordError) {
    deps.log.error({ outboxId: row.id, err: sanitizeMessage(recordError) }, "the failure could not be recorded");
  }
}

// ---- messages ------------------------------------------------------------------------------------------------------------

async function processMessage(deps: RelayDeps, row: OutboxRow): Promise<Outcome> {
  const p = row.payload;
  const target = p.target;
  if (!isObject(p) || typeof target !== "string" || !(TARGETS as readonly string[]).includes(target)) {
    return { kind: "dead", error: new Error("outbox message: the target must be customer, owner_topic or group") };
  }
  const templateKey = str(p.templateKey);
  if (templateKey === undefined) return { kind: "dead", error: new Error("outbox message: no templateKey") };
  if (!deps.telegram.enabled) return { kind: "skip", reason: "no BOT_TOKEN" };

  let chatId: number;
  let lang: Lang = "ru";
  let threadId: number | undefined;
  if ((target as Target) === "customer") {
    const customerId = str(p.customerId);
    if (customerId === undefined) return { kind: "dead", error: new Error("outbox message: no customerId") };
    const found = await deps.directory.customer(customerId);
    if ("skip" in found) return { kind: "skip", reason: found.skip };
    chatId = found.chatId;
    lang = found.lang;
  } else {
    const group = await deps.directory.ownerGroup();
    if (group === null) return { kind: "skip", reason: "the owner group is not set (telegram.owner_group)" };
    chatId = group;
    const orderId = str(p.orderId);
    const leadId = str(p.leadId);
    if ((target as Target) === "owner_topic" && (orderId !== undefined || leadId !== undefined)) {
      const topic = await deps.directory.topic({
        ...(orderId === undefined ? {} : { orderId }),
        ...(leadId === undefined ? {} : { leadId }),
      });
      if (topic !== null) threadId = topic;
    }
  }

  const params = isObject(p.params) ? p.params : {};
  const number = str(p.orderNumber);
  const text = deps.renderer.render(templateKey, lang, number === undefined ? params : { number, ...params });
  if (text === null) return { kind: "skip", reason: `no template ${templateKey}` };

  const chat = { id: chatId, group: (target as Target) !== "customer" };
  for (let waited = 0; ; waited++) {
    const wait = deps.throttle.reserve(chat, deps.now().getTime());
    if (wait === 0) break;
    if (wait > MAX_INLINE_WAIT_MS || waited >= 3) return { kind: "defer", ms: wait };
    await deps.sleep(wait);
  }

  try {
    await deps.telegram.sendMessage({ chatId, text, ...(threadId === undefined ? {} : { threadId }) });
    return { kind: "sent" };
  } catch (error) {
    return classifySendError(error);
  }
}

function classifySendError(error: unknown): Outcome {
  if (error instanceof TelegramError) {
    if (error.status === 429) return { kind: "defer", ms: (error.retryAfterSec ?? 5) * 1000 + 500 };
    if (error.status === 403) return { kind: "skip", reason: "telegram 403 (the bot is blocked or removed)" };
    if (error.status === 400 || error.status === 401 || error.status === 404) return { kind: "dead", error };
  }
  return { kind: "retry", error };
}

// ---- jobs ----------------------------------------------------------------------------------------------------------------

async function processJob(deps: RelayDeps, row: OutboxRow): Promise<Outcome> {
  const p = row.payload;
  const job = str(p.job);
  if (job === undefined) return { kind: "dead", error: new Error("outbox job: the payload names no job") };
  const refused = REFUSED_JOBS[job];
  if (refused !== undefined) return { kind: "dead", error: new Error(refused) };

  let data: Record<string, unknown> = p;
  if (job === OUTBOX_JOB.PDF_RENDER) {
    if (!(await deps.flags.isOn(PDF_FLAG))) return { kind: "defer", ms: PDF_WAIT_MS };
    // The renderer works out the watermark from the status of the offer; a hint in the payload is not forwarded.
    const { watermarkDraft: _hint, ...rest } = p;
    data = rest;
  }

  const queue = queueOfJob(job);
  if (!(await deps.jobs.hasQueue(queue))) {
    if (job === OUTBOX_JOB.PDF_RENDER) return { kind: "defer", ms: PDF_WAIT_MS };
    return {
      kind: "retry",
      error: new Error(`outbox job ${job}: the queue ${queue} does not exist (is its domain deployed?)`),
    };
  }
  // A null answer means pg-boss has the job under this key already: the row is done all the same.
  await deps.jobs.send(queue, data, { singletonKey: row.dedupeKey ?? row.id });
  return { kind: "sent" };
}
