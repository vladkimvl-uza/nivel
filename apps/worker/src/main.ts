// Background jobs on pg-boss (ARCHITECTURE 9). WP-00 made the frame; WP-14 gives the domains their runtime (the database as the
// role nivel_worker, the services, the clock, the doors to Telegram, the site and the disk), starts the queue and serves /healthz.
import { appPort, LOG_REDACT_PATHS, loadEnv } from "@nivel/config";
import { createDb } from "@nivel/db";
import { pingDatabase } from "@nivel/db/health";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { startHealthServer } from "./health.ts";
import { registerAll } from "./jobs/index.ts";
import { isCrmUrl } from "./jobs/ops/crm/sync.ts";
import { queueOptions } from "./queue.ts";
import { readExtraEnv } from "./queues/env.ts";
import { guardPool } from "./queues/pool.ts";
import { Lifecycle, type WorkerContext } from "./queues/runtime.ts";
import { createWorkerRuntime } from "./queues/wire.ts";

const env = loadEnv("worker");
const log = pino({ name: "worker", redact: [...LOG_REDACT_PATHS] });

// The CRM of the owner: both values, and the address of a web app of Google, or nothing is sent (the schema of the worker does not
// list the two keys yet: request to the integrator).
const extra = readExtraEnv();
const { sheetsUrl, sheetsSecret } = extra;
if ((sheetsUrl || sheetsSecret) && !(sheetsUrl && sheetsSecret && isCrmUrl(sheetsUrl))) {
  log.warn(
    "CRM: NIVEL_SHEETS_URL must be the address /exec of an Apps Script of Google and NIVEL_SHEETS_SECRET must be set; nothing is sent to the CRM",
  );
}
const crm = sheetsUrl && sheetsSecret && isCrmUrl(sheetsUrl) ? { url: sheetsUrl, secret: sheetsSecret } : undefined;
const port = Number(process.env.PORT) || appPort("worker", env.NIVEL_SLOT);

// The schema pgboss is made by the migration; the worker has no CREATE on the database (see queue.ts).
const boss = new PgBoss(queueOptions(env.DATABASE_URL_WORKER));
boss.on("error", (err) => log.error({ err }, "pg-boss error"));

let queue: "starting" | "started" | "stopped" = "starting";
await boss.start();
queue = "started";

// One pool of the role nivel_worker for the jobs; the services run on the same handle with the role `worker`.
const db = createDb(env.DATABASE_URL_WORKER, { max: 8, applicationName: "nivel-worker-jobs" });
guardPool(db, log);
const runtime = createWorkerRuntime({
  db,
  boss,
  log,
  settings: {
    appMode: env.APP_MODE,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    revalidateKey: env.REVALIDATE_HMAC_KEY,
    botToken: env.BOT_TOKEN,
    filesDir: env.FILES_DIR,
    // Not in the schema of the worker yet (request to the integrator): read and checked in queues/env.ts.
    botMode: extra.botMode,
    crm,
  },
  backupMarkFile: extra.backupMarkFile,
});
if (env.APP_MODE === "production") {
  if (extra.backupMarkFile === undefined)
    log.warn("BACKUP_MARK_FILE is not set: the age of the backup cannot be checked");
  if (env.FILES_DIR === undefined)
    log.warn("FILES_DIR is not set: the disk cannot be checked and the files are not purged");
}
if (!runtime.telegram.enabled) log.warn("disabled: no BOT_TOKEN, the messages of the outbox are skipped with a record");

const lifecycle = new Lifecycle();
const ctx: WorkerContext = { boss, log, runtime, onStart: lifecycle.onStart, onStop: lifecycle.onStop };
const domains = await registerAll(ctx);
log.info({ domains }, "job domains registered");
// The loops start after every domain has made its queues, so that a row of the outbox never meets a queue that is not there yet.
await lifecycle.start();

const server = await startHealthServer(port, async () => {
  const health = await pingDatabase(env.DATABASE_URL_WORKER);
  const ok = health.ok && queue === "started";
  return {
    ok,
    body: {
      app: "worker",
      status: ok ? "ok" : "degraded",
      db: health.ok ? { ok: true, ms: health.ms } : { ok: false, error: health.error },
      queue,
      domains: domains.length,
      telegram: runtime.telegram.enabled ? "enabled" : "disabled: no BOT_TOKEN",
      time: new Date().toISOString(),
    },
  };
});
log.info({ port }, `worker /healthz on http://127.0.0.1:${port}/healthz`);

const shutdown = async (signal: string) => {
  log.info({ signal }, "stopping");
  queue = "stopped";
  server.close();
  try {
    await lifecycle.stop();
  } catch (err) {
    log.error({ err }, "a loop did not stop cleanly");
  }
  await boss.stop({ graceful: true, timeout: 10_000 });
  await db.$client.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
