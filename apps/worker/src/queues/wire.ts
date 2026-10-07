// Puts the runtime of the worker together from the environment and the real doors (pg-boss, the disk, fetch). main.ts calls
// this once; the integration tests call it with their own clock and fakes for the doors that reach outside.
import type { Db } from "@nivel/db";
import { orders } from "@nivel/services";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { createProbes } from "../jobs/ops/probes.ts";
import { createFailureSink } from "./failures.ts";
import { createFileStore, disabledFileStore } from "./files.ts";
import { workerRenderer } from "./render.ts";
import type {
  AppMode,
  FileStore,
  JobSink,
  MessageRenderer,
  Probes,
  TelegramGateway,
  WorkerRuntime,
  WorkerSettings,
} from "./runtime.ts";
import { createTelegramGateway, disabledTelegram } from "./telegram.ts";
import { Throttle } from "./throttle.ts";

/** pg-boss as the relay uses it: send under a key, ask whether another domain has made a queue. */
export function createJobSink(boss: Pick<PgBoss, "send" | "getQueue">): JobSink {
  return {
    async send(queue, data, opts) {
      return boss.send(queue, data, {
        ...(opts?.singletonKey === undefined ? {} : { singletonKey: opts.singletonKey }),
        ...(opts?.startAfter === undefined ? {} : { startAfter: opts.startAfter }),
      });
    },
    async hasQueue(queue) {
      return (await boss.getQueue(queue)) !== null;
    },
  };
}

export interface RuntimeSources {
  db: Db;
  boss: Pick<PgBoss, "send" | "getQueue">;
  log: Logger;
  settings: WorkerSettings;
  now?: () => Date;
  fetch?: typeof fetch;
  /** The mark file of the backup container, when the installation has one (BACKUP_MARK_FILE). */
  backupMarkFile?: string | undefined;
  // Doors the tests replace:
  telegram?: TelegramGateway;
  renderer?: MessageRenderer;
  files?: FileStore;
  probes?: Probes;
}

export function createWorkerRuntime(o: RuntimeSources): WorkerRuntime {
  const now = o.now ?? (() => new Date());
  const doFetch = o.fetch ?? fetch;
  const appMode: AppMode = o.settings.appMode;
  return {
    db: o.db,
    services: orders.createRuntime({ db: o.db, role: "worker", appMode, now }),
    log: o.log,
    now,
    settings: o.settings,
    fetch: doFetch,
    telegram:
      o.telegram ??
      (o.settings.botToken === undefined
        ? disabledTelegram
        : createTelegramGateway({ token: o.settings.botToken, fetch: doFetch })),
    throttle: new Throttle(),
    renderer: o.renderer ?? workerRenderer,
    jobs: createJobSink(o.boss),
    files: o.files ?? (o.settings.filesDir === undefined ? disabledFileStore : createFileStore(o.settings.filesDir)),
    probes:
      o.probes ??
      createProbes({
        now,
        publicBaseUrl: o.settings.publicBaseUrl,
        dataDir: o.settings.filesDir,
        backupMarkFile: o.backupMarkFile,
      }),
    failures: createFailureSink({ db: o.db, now }),
  };
}
