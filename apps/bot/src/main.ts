// Telegram bot on grammY (ARCHITECTURE 7). WP-00: without BOT_TOKEN the bot stays disabled and serves /healthz only.
import { autoRetry } from "@grammyjs/auto-retry";
import { type RunnerHandle, run } from "@grammyjs/runner";
import { appPort, LOG_REDACT_PATHS, loadEnv } from "@nivel/config";
import { pingDatabase } from "@nivel/db/health";
import { Bot } from "grammy";
import pino from "pino";
import { startHealthServer } from "./health.ts";

const env = loadEnv("bot");
const log = pino({
  name: "bot",
  redact: [...LOG_REDACT_PATHS],
});
const port = Number(process.env.PORT) || appPort("bot", env.NIVEL_SLOT);

type BotState = "disabled" | "polling" | "webhook_pending";
let state: BotState = "disabled";
let runner: RunnerHandle | undefined;

if (!env.BOT_TOKEN) {
  log.warn("disabled: no BOT_TOKEN");
} else if (env.BOT_MODE === "polling") {
  const bot = new Bot(env.BOT_TOKEN);
  bot.api.config.use(autoRetry());
  // Scenarios (language, consent, selection, lead, owner group) are built by WP-13.
  bot.command("start", (ctx) => ctx.reply("Nivel: bot ishlab chiqilmoqda / бот в разработке"));
  bot.catch((err) => log.error({ err: err.error }, "bot error"));
  runner = run(bot);
  state = "polling";
  log.info("polling started");
} else {
  // Webhook (https://nivel.uz/tg/<path>, secret header) is wired by WP-13 behind Caddy.
  state = "webhook_pending";
  log.warn("webhook mode is not wired yet (WP-13); bot idle");
}

const server = await startHealthServer(port, async () => {
  const db = await pingDatabase(env.DATABASE_URL_BOT);
  return {
    ok: db.ok,
    body: {
      app: "bot",
      status: db.ok ? "ok" : "degraded",
      bot: state,
      db: db.ok ? { ok: true, ms: db.ms } : { ok: false, error: db.error },
      time: new Date().toISOString(),
    },
  };
});
log.info({ port, bot: state }, `bot /healthz on http://127.0.0.1:${port}/healthz`);

const shutdown = async (signal: string) => {
  log.info({ signal }, "stopping");
  server.close();
  if (runner?.isRunning()) await runner.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
