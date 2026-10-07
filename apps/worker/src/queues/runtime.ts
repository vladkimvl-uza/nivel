// What a job of the worker runs on: the database of the role `nivel_worker`, the scenarios of the services on the same handle,
// the clock and the doors to the outside world (Telegram, the site, the disk, pg-boss). Every outside door is a port, so the
// tests bring fakes and the code never reaches the network by itself (CLAUDE.md: the tests do not use the network).
import type { Db } from "@nivel/db";
import type { orders } from "@nivel/services";
import type { Logger } from "pino";
import type { CrmConfig } from "../jobs/ops/crm/sync.ts";
import type { JobContext } from "../jobs/types.ts";
import type { FailureSink } from "./failures.ts";
import type { Throttle } from "./throttle.ts";

export type Lang = "uz" | "ru";
export type AppMode = "development" | "staging" | "production";

export interface WorkerSettings {
  appMode: AppMode;
  /** PUBLIC_BASE_URL: where the site answers (POST /api/internal/revalidate). */
  publicBaseUrl: string;
  /** REVALIDATE_HMAC_KEY: the key shared with the site; never written into the code or the log. */
  revalidateKey: string;
  /** BOT_TOKEN: without it nothing is sent to Telegram, the row of the outbox is skipped with a record. */
  botToken: string | undefined;
  /** FILES_DIR: where the bytes of the files lie; without it the retention of files does not run. */
  filesDir: string | undefined;
  /** NIVEL_SHEETS_URL and NIVEL_SHEETS_SECRET: the web app of the CRM of the owner in Google Sheets; absent, nothing goes to the CRM. */
  crm?: CrmConfig | undefined;
  /** BOT_MODE of the installation: in `webhook` mode ops.selfcheck looks at the last error of the webhook. */
  botMode?: "polling" | "webhook" | undefined;
}

/** Sends a job to a queue of pg-boss; the real one is a thin cover over the `PgBoss` of the process. */
export interface JobSink {
  /**
   * `id` is the id of the job (a UUID): a second send under the same id makes no second job and answers `null`. `singletonKey`
   * alone does not do that on a queue with the standard policy, so whoever needs "once" passes an id.
   */
  send(
    queue: string,
    data: object,
    opts?: { id?: string; singletonKey?: string; startAfter?: Date },
  ): Promise<string | null>;
  /** Whether another domain has made the queue already (pdf.render is made by WP-12). */
  hasQueue(queue: string): Promise<boolean>;
  /** Queues whose oldest ready job has waited more than `seconds` (nobody takes it: ops.selfcheck). */
  stalled(seconds: number): Promise<{ queue: string; seconds: number }[]>;
}

export interface SendMessageInput {
  chatId: number | string;
  text: string;
  /** The topic of a forum group. */
  threadId?: number;
}

/** The Bot API as far as the worker needs it. A failure is a `TelegramError`. */
export interface TelegramGateway {
  /** False without BOT_TOKEN. */
  readonly enabled: boolean;
  sendMessage(input: SendMessageInput): Promise<{ messageId: number }>;
  getWebhookInfo(): Promise<{ url: string; lastErrorDate: number | null; lastErrorMessage: string | null }>;
}

/** Turns the key of a template into text. `null` when the renderer does not know the key. */
export interface MessageRenderer {
  render(templateKey: string, lang: Lang, params: Readonly<Record<string, unknown>>): string | null;
}

export interface FileStore {
  /** Removes the bytes of a file; a file that is not there is removed already. */
  remove(storageKey: string): Promise<void>;
}

/** What `ops.selfcheck` looks at outside the database; `null` means "this runtime cannot tell". */
export interface Probes {
  /** Hours since the last good copy of the database (the backup container leaves a mark). */
  backupAgeHours(): Promise<number | null>;
  /** Percent of the disk with the data in use. */
  diskUsedPercent(): Promise<number | null>;
  /** Days left of the certificate of the public domain. */
  certDaysLeft(): Promise<number | null>;
}

export interface WorkerRuntime {
  readonly db: Db;
  /** The scenarios of `@nivel/services` on the same handle, with the role `worker`. */
  readonly services: orders.Runtime;
  readonly log: Logger;
  now(): Date;
  readonly settings: WorkerSettings;
  readonly fetch: typeof fetch;
  readonly telegram: TelegramGateway;
  readonly throttle: Throttle;
  readonly renderer: MessageRenderer;
  readonly jobs: JobSink;
  readonly files: FileStore;
  readonly probes: Probes;
  readonly failures: FailureSink;
}

/** What a domain receives at registration: the context of WP-00 and the runtime of the worker. */
export interface WorkerContext extends JobContext {
  readonly runtime: WorkerRuntime;
  /** Registers something to run once every domain has registered its queues (the polling loop of the relay). */
  onStart(fn: () => Promise<void> | void): void;
  /** Registers something to close at shutdown. */
  onStop(fn: () => Promise<void> | void): void;
}

/** The start and stop hooks of the domains: `start()` runs them in the order they were added, `stop()` in the reverse order. */
export class Lifecycle {
  readonly #starts: (() => Promise<void> | void)[] = [];
  readonly #stops: (() => Promise<void> | void)[] = [];
  onStart = (fn: () => Promise<void> | void): void => {
    this.#starts.push(fn);
  };
  onStop = (fn: () => Promise<void> | void): void => {
    this.#stops.push(fn);
  };
  async start(): Promise<void> {
    for (const fn of this.#starts) await fn();
  }
  /** Runs every hook even if one throws; the first error is thrown at the end. */
  async stop(): Promise<void> {
    let first: unknown;
    for (const fn of [...this.#stops].reverse()) {
      try {
        await fn();
      } catch (error) {
        first ??= error;
      }
    }
    if (first !== undefined) throw first;
  }
}

/** A domain registers with the context of WP-00 (`JobContext`); the worker hands it a `WorkerContext`, and this checks it. */
export function workerContext(ctx: JobContext): WorkerContext {
  const c = ctx as Partial<WorkerContext>;
  if (c.runtime === undefined || c.onStart === undefined || c.onStop === undefined) {
    throw new Error("the job domain was registered without the runtime of the worker (see main.ts)");
  }
  return ctx as WorkerContext;
}
