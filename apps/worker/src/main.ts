// Background jobs on pg-boss (ARCHITECTURE 9). WP-00: start the queue, register domains, serve /healthz.
import { appPort, LOG_REDACT_PATHS, loadEnv } from "@nivel/config";
import { pingDatabase } from "@nivel/db/health";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { startHealthServer } from "./health.ts";
import { registerAll } from "./jobs/index.ts";
import { queueOptions } from "./queue.ts";

const env = loadEnv("worker");
const log = pino({ name: "worker", redact: [...LOG_REDACT_PATHS] });
const port = Number(process.env.PORT) || appPort("worker", env.NIVEL_SLOT);

// The schema pgboss is made by the migration; the worker has no CREATE on the database (see queue.ts).
const boss = new PgBoss(queueOptions(env.DATABASE_URL_WORKER));
boss.on("error", (err) => log.error({ err }, "pg-boss error"));

let queue: "starting" | "started" | "stopped" = "starting";
await boss.start();
queue = "started";
const domains = await registerAll({ boss, log });
log.info({ domains }, "job domains registered");

const server = await startHealthServer(port, async () => {
  const db = await pingDatabase(env.DATABASE_URL_WORKER);
  const ok = db.ok && queue === "started";
  return {
    ok,
    body: {
      app: "worker",
      status: ok ? "ok" : "degraded",
      db: db.ok ? { ok: true, ms: db.ms } : { ok: false, error: db.error },
      queue,
      domains: domains.length,
      time: new Date().toISOString(),
    },
  };
});
log.info({ port }, `worker /healthz on http://127.0.0.1:${port}/healthz`);

const shutdown = async (signal: string) => {
  log.info({ signal }, "stopping");
  queue = "stopped";
  server.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
