import { loadEnv } from "@nivel/config";
import type { Db } from "@nivel/db";
import { Bot } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type StartedApp, startApp } from "./app.ts";
import type { BotContext } from "./context.ts";
import { webhookPath } from "./server.ts";
import { BOT_INFO, FakeTelegram } from "./testing/fake-telegram.ts";

const TOKEN = "123456:TEST-token-of-the-app-tests"; // gitleaks:allow made-up value, never a real bot token
const SECRET = "app-test-webhook-secret-0123456789abcdef"; // gitleaks:allow made-up value, never a real secret

const baseEnv = {
  APP_MODE: "production",
  NIVEL_SLOT: "1",
  DATABASE_URL_BOT: "postgres://nivel_bot:x@127.0.0.1:1/nivel_test",
  TELEGRAM_OWNER_IDS: "6001000001",
  PUBLIC_BASE_URL: "https://nivel.test",
};
const envOf = (extra: Record<string, string> = {}) => loadEnv("bot", { ...baseEnv, ...extra });

const running: StartedApp[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (running.length > 0) await running.pop()?.stop();
});

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface Rig {
  app: StartedApp;
  log: ReturnType<typeof logger>;
  tg: FakeTelegram;
  bot: Bot<BotContext>;
  factory: ReturnType<typeof vi.fn>;
  poll: ReturnType<typeof vi.fn>;
  stopPoll: ReturnType<typeof vi.fn>;
  sweep: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
}

async function start(
  extra: Record<string, string> = {},
  o: { dbOk?: boolean; sweepEveryMs?: number } = {},
): Promise<Rig> {
  const log = logger();
  const tg = new FakeTelegram();
  const bot = new Bot<BotContext>(TOKEN, { botInfo: BOT_INFO });
  tg.install(bot);
  const factory = vi.fn(() => bot);
  const stopPoll = vi.fn(async () => {});
  const poll = vi.fn(() => ({ stop: stopPoll }));
  const sweep = vi.fn(async () => 0);
  const ping = vi.fn(async () =>
    o.dbOk === false
      ? { ok: false as const, error: "db_unreachable" as const }
      : { ok: true as const, ms: 2, queueSchema: true },
  );
  const app = await startApp({
    env: envOf(extra),
    db: {} as Db,
    rt: {} as never,
    log: log as never,
    port: 0,
    ping,
    botFactory: factory,
    poll,
    sweep,
    ...(o.sweepEveryMs === undefined ? {} : { sweepEveryMs: o.sweepEveryMs }),
  });
  running.push(app);
  return { app, log, tg, bot, factory, poll, stopPoll, sweep, ping };
}

const get = (app: StartedApp, path = "/healthz") => fetch(`http://127.0.0.1:${app.port}${path}`);

describe("without BOT_TOKEN (CLAUDE.md: «disabled: no BOT_TOKEN» and /healthz only)", () => {
  it("says so, makes no bot and answers /healthz with the state disabled", async () => {
    const r = await start();
    expect(r.app.state).toBe("disabled");
    expect(r.log.warn).toHaveBeenCalledWith("disabled: no BOT_TOKEN");
    expect(r.factory).not.toHaveBeenCalled();
    expect(r.poll).not.toHaveBeenCalled();
    const res = await get(r.app);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ app: "bot", status: "ok", bot: "disabled" });
  });

  it("serves nothing but /healthz: no webhook path even when the mode asks for one", async () => {
    const r = await start({ BOT_MODE: "webhook", BOT_WEBHOOK_SECRET: SECRET });
    expect(r.app.state).toBe("disabled");
    const res = await fetch(`http://127.0.0.1:${r.app.port}${webhookPath(SECRET)}`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(res.status).toBe(404);
    expect((await get(r.app, "/anything")).status).toBe(404);
  });

  it("reports the database like the other apps do: 503 and «degraded» when it is down", async () => {
    const r = await start({}, { dbOk: false });
    const res = await get(r.app);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", db: { ok: false, error: "db_unreachable" } });
  });
});

describe("BOT_MODE=polling", () => {
  it("drops a webhook that may be left, sets the commands and the descriptions in both languages and starts polling", async () => {
    const r = await start({ BOT_TOKEN: TOKEN });
    expect(r.app.state).toBe("polling");
    expect(r.factory).toHaveBeenCalledTimes(1);
    expect(r.poll).toHaveBeenCalledWith(r.bot);
    expect(r.tg.of("deleteWebhook")).toHaveLength(1);
    const commands = r.tg
      .of("setMyCommands")
      .map((c) => [c.payload.language_code, (c.payload.commands as { command: string }[]).length]);
    expect(commands).toEqual([
      [undefined, 7],
      ["uz", 7],
      ["ru", 7],
    ]);
    expect(r.tg.of("setMyDescription").map((c) => c.payload.language_code)).toEqual([undefined, "uz", "ru"]);
    expect(r.tg.of("setMyShortDescription").map((c) => c.payload.language_code)).toEqual([undefined, "uz", "ru"]);
    // The default is Uzbek: it comes first.
    const first = r.tg.of("setMyCommands")[0]?.payload.commands as { description: string }[] | undefined;
    expect(first?.[0]?.description).toBe("Boshlash");
    expect(await (await get(r.app)).json()).toMatchObject({ bot: "polling" });
  });

  it("goes on when Telegram refuses the commands: the bot answers people, the error is logged", async () => {
    const log = logger();
    const tg = new FakeTelegram();
    const bot = new Bot<BotContext>(TOKEN, { botInfo: BOT_INFO });
    tg.install(bot);
    tg.failNext("setMyCommands", { error_code: 429, description: "Too Many Requests: retry after 5" });
    const app = await startApp({
      env: envOf({ BOT_TOKEN: TOKEN }),
      db: {} as Db,
      rt: {} as never,
      log: log as never,
      port: 0,
      ping: async () => ({ ok: true, ms: 1, queueSchema: true }),
      botFactory: () => bot,
      poll: () => ({ stop: async () => {} }),
      sweep: async () => 0,
    });
    running.push(app);
    expect(app.state).toBe("polling");
    expect(log.error).toHaveBeenCalled();
  });

  it("stop() stops the polling and closes the port", async () => {
    const r = await start({ BOT_TOKEN: TOKEN });
    await r.app.stop();
    expect(r.stopPoll).toHaveBeenCalledTimes(1);
    await expect(get(r.app)).rejects.toThrow();
  });
});

describe("BOT_MODE=webhook", () => {
  const env = { BOT_TOKEN: TOKEN, BOT_MODE: "webhook", BOT_WEBHOOK_SECRET: SECRET };

  it("registers the address with the secret and the kinds of updates it needs, and does not poll", async () => {
    const r = await start(env);
    expect(r.app.state).toBe("webhook");
    expect(r.poll).not.toHaveBeenCalled();
    const call = r.tg.of("setWebhook")[0];
    expect(call?.payload).toMatchObject({
      url: `https://nivel.test${webhookPath(SECRET)}`,
      secret_token: SECRET,
      allowed_updates: ["message", "callback_query"],
    });
    expect(r.tg.of("deleteWebhook")).toHaveLength(0);
  });

  it("takes updates on the path with the secret, and nothing else", async () => {
    const r = await start(env);
    const handle = vi.spyOn(r.bot, "handleUpdate").mockResolvedValue();
    const url = `http://127.0.0.1:${r.app.port}${webhookPath(SECRET)}`;
    const update = { update_id: 77, message: { message_id: 1, date: 1, chat: { id: 5, type: "private" }, text: "x" } };
    const wrong = await fetch(url, { method: "POST", body: JSON.stringify(update) });
    expect(wrong.status).toBe(403);
    const ok = await fetch(url, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify(update),
    });
    expect(ok.status).toBe(200);
    await vi.waitFor(() => expect(handle).toHaveBeenCalledWith(update));
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("initialises a bot that knows nothing of itself (getMe) before it takes the first update, so the update is really answered", async () => {
    const log = logger();
    const tg = new FakeTelegram();
    // Without botInfo, like the process of the bot (main.ts): grammY refuses every update until init() is called.
    const bare = new Bot<BotContext>(TOKEN);
    bare.on("message", (ctx) => ctx.reply("pong"));
    tg.install(bare);
    const app = await startApp({
      env: envOf(env),
      db: {} as Db,
      rt: {} as never,
      log: log as never,
      port: 0,
      ping: async () => ({ ok: true, ms: 1, queueSchema: true }),
      botFactory: () => bare,
      sweep: async () => 0,
    });
    running.push(app);
    expect(tg.of("getMe")).toHaveLength(1);
    // The bot knows itself before the address is given to Telegram: no update can arrive before that.
    const order = tg.calls.map((c) => c.method);
    expect(order.indexOf("getMe")).toBeLessThan(order.indexOf("setWebhook"));
    const res = await fetch(`http://127.0.0.1:${app.port}${webhookPath(SECRET)}`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({
        update_id: 91,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 5, type: "private" },
          from: { id: 5, is_bot: false, first_name: "A" },
          text: "x",
        },
      }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(tg.of("sendMessage")).toHaveLength(1));
    expect(tg.of("sendMessage")[0]?.payload).toMatchObject({ chat_id: 5, text: "pong" });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("does not take the address when the bot cannot be initialised: the process fails loudly, not silently mute", async () => {
    const tg = new FakeTelegram();
    const bare = new Bot<BotContext>(TOKEN);
    tg.install(bare);
    tg.failNext("getMe", { error_code: 401, description: "Unauthorized" });
    await expect(
      startApp({
        env: envOf(env),
        db: {} as Db,
        rt: {} as never,
        log: logger() as never,
        port: 0,
        ping: async () => ({ ok: true, ms: 1, queueSchema: true }),
        botFactory: () => bare,
        sweep: async () => 0,
      }),
    ).rejects.toThrow();
    expect(tg.of("setWebhook")).toHaveLength(0);
  });

  it("a refusal of setWebhook ends the start with the words of Telegram only: the secret does not leave with the error", async () => {
    const tg = new FakeTelegram();
    const bare = new Bot<BotContext>(TOKEN, { botInfo: BOT_INFO });
    tg.install(bare);
    tg.failNext("setWebhook", {
      error_code: 400,
      description: "Bad Request: secret token contains unallowed characters",
    });
    const failed = await startApp({
      env: envOf(env),
      db: {} as Db,
      rt: {} as never,
      log: logger() as never,
      port: 0,
      ping: async () => ({ ok: true, ms: 1, queueSchema: true }),
      botFactory: () => bare,
      sweep: async () => 0,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failed).toBeInstanceOf(Error);
    expect(String((failed as Error).message)).toContain("setWebhook was refused by Telegram: 400");
    expect(JSON.stringify(failed, Object.getOwnPropertyNames(failed))).not.toContain(SECRET);
  });

  it("an update that fails in the bot is logged, not answered with an error", async () => {
    const r = await start(env);
    vi.spyOn(r.bot, "handleUpdate").mockRejectedValue(new Error("boom"));
    const res = await fetch(`http://127.0.0.1:${r.app.port}${webhookPath(SECRET)}`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({ update_id: 78 }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(r.log.error).toHaveBeenCalled());
  });
});

describe("the sweep of the topics", () => {
  it("runs on a timer while the bot works and stops with it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const r = await start({ BOT_TOKEN: TOKEN }, { sweepEveryMs: 30_000 });
    expect(r.sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.sweep).toHaveBeenCalledTimes(3);
    await r.app.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(r.sweep).toHaveBeenCalledTimes(3);
  });

  it("a failed sweep is logged and the timer goes on", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const r = await start({ BOT_TOKEN: TOKEN }, { sweepEveryMs: 1_000 });
    r.sweep.mockRejectedValueOnce(new Error("db down"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.log.error).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.sweep).toHaveBeenCalledTimes(2);
  });

  it("does not start a run while the previous one is still going (a slow Telegram makes no double topics)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const r = await start({ BOT_TOKEN: TOKEN }, { sweepEveryMs: 1_000 });
    let finish: () => void = () => {};
    r.sweep.mockImplementationOnce(() => new Promise<number>((resolve) => (finish = () => resolve(0))));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(r.sweep).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.sweep).toHaveBeenCalledTimes(2);
  });

  it("does not run without a bot", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const r = await start({}, { sweepEveryMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(r.sweep).not.toHaveBeenCalled();
  });
});
