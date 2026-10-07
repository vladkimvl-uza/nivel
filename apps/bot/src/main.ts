// Telegram bot on grammY (ARCHITECTURE 7). Without BOT_TOKEN the bot stays disabled and serves /healthz only.
import { appPort, LOG_REDACT_PATHS, loadEnv } from "@nivel/config";
import { createDb } from "@nivel/db";
import { pingDatabase } from "@nivel/db/health";
import { orders } from "@nivel/services";
import pino from "pino";
import { startApp } from "./app.ts";

const env = loadEnv("bot");
const log = pino({
  name: "bot",
  redact: [...LOG_REDACT_PATHS],
});
const port = Number(process.env.PORT) || appPort("bot", env.NIVEL_SLOT);

const db = createDb(env.DATABASE_URL_BOT, { max: 5 });
// Every scenario of the services is called with this runtime: the database as the role of the bot.
const rt = orders.configureServices({ db, role: "bot", appMode: env.APP_MODE });

const app = await startApp({ env, db, rt, log, port, ping: () => pingDatabase(env.DATABASE_URL_BOT) });

const shutdown = async (signal: string) => {
  log.info({ signal }, "stopping");
  await app.stop();
  await db.$client.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
