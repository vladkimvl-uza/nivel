// crm.sync (ARCHITECTURE 9; tools/crm-sheets/README.md "Вебхук: контракт"): the worker feeds the CRM of the owner in Google Sheets.
// Two steps, both on the queues of pg-boss:
//  - `crm.collect` (every minute) looks for things that are new for the CRM (a request, an event of the journal of an order, a
//    confirmed payment, a receipt, a warranty case) and puts a job `crm.sync` for each into the outbox under a key that holds the
//    thing: the outbox is the memory of what has been queued, so no table of its own is needed, and the CRM is idempotent;
//  - `crm.sync` reads the thing from the database, builds the event, signs it and posts it; one event a second at most.
// Without NIVEL_SHEETS_URL and NIVEL_SHEETS_SECRET nothing is queued and nothing is sent.
import type { ops } from "@nivel/db/repos";
import type { Logger } from "pino";
import { PermanentJobError } from "../../../queues/define.ts";
import { sanitizeMessage } from "../../../queues/failures.ts";
import {
  CRM_EVENT_TYPES,
  type CrmEventType,
  envelope,
  type LeadFacts,
  leadCreatedData,
  type OrderChangeFacts,
  orderStatusChangedData,
  type PaymentFacts,
  type PurchaseFacts,
  paymentConfirmedData,
  purchaseRecordedData,
  signedRequest,
  type WarrantyFacts,
  warrantyCaseOpenedData,
} from "./events.ts";

export interface CrmConfig {
  /** NIVEL_SHEETS_URL: the address /exec of the web app of the script of the CRM. */
  url: string;
  /** NIVEL_SHEETS_SECRET: the key of the signature (the one shown once by the menu of the CRM). Never logged. */
  secret: string;
}

/** Only the web app of an Apps Script of Google: https, script.google.com, /macros/s/<id>/exec, no login and no port. */
export function isCrmUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.hostname === "script.google.com" &&
    u.port === "" &&
    u.username === "" &&
    u.password === "" &&
    /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)
  );
}

// ---- the limit of one event a second --------------------------------------------------------------------------------------

export interface RateLimiter {
  wait(): Promise<void>;
}

/** Holds the callers so that two of them are never closer than `gapMs` (the CRM allows 30 runs at once, the contract asks one a second). */
export function createRateLimiter(o: {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  gapMs: number;
}): RateLimiter {
  let next = 0;
  return {
    async wait() {
      const t = o.now();
      const at = Math.max(t, next);
      if (at > t) await o.sleep(at - t);
      next = Math.max(o.now(), at) + o.gapMs;
    },
  };
}

// ---- sending ------------------------------------------------------------------------------------------------------------------

export interface CrmDeps {
  now(): Date;
  log: Logger;
  config: CrmConfig | null;
  /** The environment of the worker (APP_MODE): the CRM takes events of the environment named in its settings only. */
  env: string;
  fetch: typeof fetch;
  limiter: RateLimiter;
  facts: {
    lead(id: string): Promise<LeadFacts | null>;
    order(id: string, seq: number): Promise<OrderChangeFacts | null>;
    payment(id: string): Promise<PaymentFacts | null>;
    purchase(id: string): Promise<PurchaseFacts | null>;
    warranty(id: string): Promise<WarrantyFacts | null>;
  };
  timeoutMs?: number;
}

export type CrmSyncResult = { sent: true; result: string } | { sent: false; reason: "no_config" | "no_facts" };

const TIMEOUT_MS = 20_000;
/** The CRM says the event is wrong: the same event is refused every time (the contract: do not repeat, write to ops.app_errors). */
const REFUSED = new Set(["bad_signature", "bad_payload", "wrong_env", "unknown_type"]);

export async function handleCrmSync(
  deps: CrmDeps,
  data: Record<string, unknown>,
  jobId: string,
): Promise<CrmSyncResult> {
  const { config } = deps;
  if (config === null) return { sent: false, reason: "no_config" };
  if (!isCrmUrl(config.url))
    throw new PermanentJobError("crm.sync: NIVEL_SHEETS_URL is not the address /exec of an Apps Script of Google");
  const type = data.type;
  const ref = data.ref;
  if (
    typeof type !== "string" ||
    !(CRM_EVENT_TYPES as readonly string[]).includes(type) ||
    typeof ref !== "string" ||
    ref === ""
  ) {
    throw new PermanentJobError("crm.sync: the job must name an event type of the CRM and the thing");
  }
  const seq = data.seq;
  if (type === "order.status_changed" && !(typeof seq === "number" && Number.isInteger(seq) && seq >= 0)) {
    throw new PermanentJobError("crm.sync: an order event names the number of the event of the journal");
  }

  const built = await build(deps, type as CrmEventType, ref, typeof seq === "number" ? seq : 0);
  if (built === null) {
    deps.log.info({ type }, "crm.sync: nothing to send (the thing is gone or is not for the CRM)");
    return { sent: false, reason: "no_facts" };
  }

  await deps.limiter.wait();
  const now = deps.now();
  const env = envelope({
    id: jobId,
    type: type as CrmEventType,
    env: deps.env,
    occurredAt: built.occurredAt,
    sentAt: now,
    data: built.data,
  });
  const request = signedRequest(config.url, config.secret, env, now);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  let status: number;
  let answer: { ok?: unknown; result?: unknown; error?: unknown };
  // The timer runs until the body is read: a server that sends the head of the answer and goes silent must not hold the queue.
  try {
    const response = await deps.fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.body,
      signal: controller.signal,
    });
    status = response.status;
    if (status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`crm.sync: the CRM answered HTTP ${status}`);
    }
    try {
      answer = (await response.json()) as typeof answer;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error(`crm.sync: the answer of the CRM is not JSON (HTTP ${status})`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("crm.sync:")) throw error;
    // The address of the request holds the signature: only the kind of the failure is written.
    const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    throw new Error(
      `crm.sync: no answer from the CRM (${aborted ? "timeout" : sanitizeMessage(error).replaceAll(config.secret, "<key>")})`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (typeof answer !== "object" || answer === null || typeof answer.ok !== "boolean") {
    throw new Error("crm.sync: the answer of the CRM has no ok");
  }
  if (answer.ok) {
    deps.log.info({ type, result: answer.result }, "crm.sync: delivered");
    return { sent: true, result: typeof answer.result === "string" ? answer.result : "applied" };
  }
  const error = typeof answer.error === "string" ? answer.error : "unknown";
  if (REFUSED.has(error)) throw new PermanentJobError(`crm.sync: the CRM refused the event: ${error}`);
  // locked (the book is busy), internal (a failure on the side of Google), stale (the stamp is out of the term: the next try signs anew)
  throw new Error(`crm.sync: the CRM answered ${error}`);
}

async function build(
  deps: CrmDeps,
  type: CrmEventType,
  ref: string,
  seq: number,
): Promise<{ data: Record<string, unknown>; occurredAt: Date } | null> {
  switch (type) {
    case "lead.created": {
      const f = await deps.facts.lead(ref);
      return f === null ? null : { data: leadCreatedData(f), occurredAt: f.createdAt };
    }
    case "order.status_changed": {
      const f = await deps.facts.order(ref, seq);
      return f === null ? null : { data: orderStatusChangedData(f), occurredAt: f.at };
    }
    case "payment.confirmed": {
      const f = await deps.facts.payment(ref);
      return f === null ? null : { data: paymentConfirmedData(f), occurredAt: f.confirmedAt ?? f.occurredAt };
    }
    case "purchase.recorded": {
      const f = await deps.facts.purchase(ref);
      return f === null ? null : { data: purchaseRecordedData(f), occurredAt: f.boughtAt };
    }
    case "warranty.case_opened": {
      const f = await deps.facts.warranty(ref);
      return f === null ? null : { data: warrantyCaseOpenedData(f), occurredAt: f.openedAt };
    }
  }
}

// ---- collecting ---------------------------------------------------------------------------------------------------------------

export interface CrmRef {
  type: CrmEventType;
  ref: string;
  /** The number of the event of the journal of the order (order.status_changed). */
  seq?: number;
  dedupeKey: string;
}

export interface CollectDeps {
  now(): Date;
  log: Logger;
  config: CrmConfig | null;
  /** Things that happened lately and are not in the outbox yet. */
  candidates(now: Date): Promise<CrmRef[]>;
  enqueue(input: ops.OutboxInput): Promise<{ duplicate: boolean }>;
}

export async function collectCrmEvents(deps: CollectDeps): Promise<{ queued: number }> {
  if (deps.config === null) return { queued: 0 };
  let queued = 0;
  for (const c of await deps.candidates(deps.now())) {
    const made = await deps.enqueue({
      kind: "job",
      dedupeKey: c.dedupeKey,
      // Background: the CRM waits for nobody, the messages to people go first.
      priority: -5,
      payload: { job: "crm.sync", type: c.type, ref: c.ref, ...(c.seq === undefined ? {} : { seq: c.seq }) },
    });
    if (!made.duplicate) queued += 1;
  }
  if (queued > 0) deps.log.info({ queued }, "crm.collect");
  return { queued };
}
