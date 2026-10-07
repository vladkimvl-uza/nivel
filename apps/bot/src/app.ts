// The process of the bot (ARCHITECTURE 7.1): without BOT_TOKEN it only says «disabled: no BOT_TOKEN» and keeps /healthz;
// with it, `polling` (the default in R0: no public address) or `webhook` (https://<host>/tg/<path> behind Caddy).

import type { Server } from "node:http";
import { autoRetry } from "@grammyjs/auto-retry";
import { run } from "@grammyjs/runner";
import type { Env } from "@nivel/config";
import type { Db } from "@nivel/db";
import type { DbHealth } from "@nivel/db/health";
import type { orders } from "@nivel/services";
import type { Bot } from "grammy";
import type { Logger } from "pino";
import { createBot } from "./bot.ts";
import { configureBot } from "./configure.ts";
import type { BotContext } from "./context.ts";
import type { BotDeps } from "./deps.ts";
import { startServer, webhookPath } from "./server.ts";
import { sweepLeadTopics } from "./topics.ts";

export type BotState = "disabled" | "polling" | "webhook";

/** The kinds of updates the bot needs (ARCHITECTURE 7.1: only those). */
export const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export interface AppOptions {
  env: Env<"bot">;
  db: Db;
  rt: orders.Runtime;
  log: Pick<Logger, "info" | "warn" | "error">;
  /** The port to listen on; 0 takes a free one (tests). */
  port: number;
  ping: () => Promise<DbHealth>;
  now?: () => Date;
  botFactory?: (deps: BotDeps, token: string) => Bot<BotContext>;
  poll?: (bot: Bot<BotContext>) => { stop(): Promise<void> };
  sweep?: (api: Bot<BotContext>["api"], deps: BotDeps) => Promise<number>;
  /** How often the topics of the requests without one are made (30 seconds). */
  sweepEveryMs?: number;
}

export interface StartedApp {
  state: BotState;
  port: number;
  server: Server;
  stop(): Promise<void>;
}

export async function startApp(o: AppOptions): Promise<StartedApp> {
  const { env, log } = o;
  const deps: BotDeps = {
    db: o.db,
    rt: o.rt,
    now: o.now ?? (() => new Date()),
    appMode: env.APP_MODE,
    ownerIds: env.TELEGRAM_OWNER_IDS,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    log,
  };
  let state: BotState = "disabled";
  let bot: Bot<BotContext> | undefined;
  let poller: { stop(): Promise<void> } | undefined;
  let sweeper: ReturnType<typeof setInterval> | undefined;

  if (!env.BOT_TOKEN) {
    log.warn("disabled: no BOT_TOKEN");
  } else {
    bot = (o.botFactory ?? ((d, token) => createBot(d, { token })))(deps, env.BOT_TOKEN);
    bot.api.config.use(autoRetry());
    state = env.BOT_MODE === "webhook" ? "webhook" : "polling";
  }

  const webhook =
    bot !== undefined && state === "webhook" && env.BOT_WEBHOOK_SECRET !== undefined
      ? {
          path: webhookPath(env.BOT_WEBHOOK_SECRET),
          secret: env.BOT_WEBHOOK_SECRET,
          onUpdate: (update: unknown) => (bot as Bot<BotContext>).handleUpdate(update as never),
        }
      : undefined;

  const { server, port } = await startServer({
    port: o.port,
    health: async () => {
      const db = await o.ping();
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
    },
    ...(webhook === undefined ? {} : { webhook }),
    onError: (err) => log.error({ err }, "webhook update failed"),
  });

  if (bot !== undefined) {
    try {
      await configureBot(bot.api);
    } catch (err) {
      // The commands are for convenience; a bot that cannot set them still answers people.
      log.error({ err }, "the commands and the descriptions of the bot were not set");
    }
    if (webhook !== undefined && env.BOT_WEBHOOK_SECRET !== undefined) {
      await bot.api.setWebhook(`${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}${webhook.path}`, {
        secret_token: env.BOT_WEBHOOK_SECRET,
        allowed_updates: [...ALLOWED_UPDATES],
      });
      log.info({ port }, "webhook set");
    } else {
      // Telegram refuses getUpdates while a webhook is set.
      await bot.api.deleteWebhook();
      poller = (o.poll ?? ((b) => run(b, { runner: { fetch: { allowed_updates: [...ALLOWED_UPDATES] } } })))(bot);
      log.info({ port }, "polling started");
    }
    const api = bot.api;
    const sweep = o.sweep ?? sweepLeadTopics;
    sweeper = setInterval(() => {
      sweep(api, deps).catch((err) => log.error({ err }, "the sweep of the topics failed"));
    }, o.sweepEveryMs ?? 30_000);
    sweeper.unref?.();
  }
  log.info({ port, bot: state }, `bot /healthz on http://127.0.0.1:${port}/healthz`);

  return {
    state,
    port,
    server,
    async stop() {
      if (sweeper !== undefined) clearInterval(sweeper);
      sweeper = undefined;
      const p = poller;
      poller = undefined;
      await p?.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
