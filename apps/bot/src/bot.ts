// The bot (ARCHITECTURE 7): one program, one client bot and the closed group of the owner. Updates go through three gates:
// each is handled once (`bot.processed_updates`), groups other than the owner's are not answered, and the private chat
// has a session (`bot.sessions`) and a customer who has agreed before anything else is done.
import { bot as botRepo } from "@nivel/db/repos";
import { botTranslator } from "@nivel/telegram";
import { Bot, Composer, session } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { ownerGroupId } from "./config.ts";
import type { BotContext } from "./context.ts";
import type { BotDeps } from "./deps.ts";
import { actButtons } from "./handlers/acts.ts";
import { info } from "./handlers/info.ts";
import { myOrders } from "./handlers/orders.ts";
import { loadProfile } from "./handlers/profile.ts";
import { relayToTopic } from "./handlers/relay.ts";
import { request } from "./handlers/request.ts";
import { select } from "./handlers/select.ts";
import { staff } from "./handlers/staff.ts";
import { askLanguage, start } from "./handlers/start.ts";
import { warranty } from "./handlers/warranty.ts";
import { dbStorage, initialSession, sessionKey } from "./session.ts";
import { ack, button, say } from "./ui.ts";

export interface CreateBotOptions {
  token: string;
  /** With the data of the bot Telegram is not asked `getMe` before the first update (tests and webhooks). */
  botInfo?: UserFromGetMe;
}

function customerComposer(deps: BotDeps): Composer<BotContext> {
  const c = new Composer<BotContext>();
  c.use(
    session({
      initial: initialSession,
      storage: dbStorage(deps.db),
      getSessionKey: (ctx) => (ctx.chat?.type === "private" ? sessionKey(ctx.chat.id) : undefined),
    }),
  );
  c.use(async (ctx, next) => {
    if (ctx.session.lang !== undefined) {
      ctx.lang = ctx.session.lang;
      ctx.t = botTranslator(ctx.lang);
    }
    await next();
  });
  c.use(start);
  // From here on only a customer who chose a language and agreed.
  c.use(async (ctx, next) => {
    const profile = await loadProfile(ctx);
    if (ctx.session.lang === undefined) {
      await ack(ctx);
      return askLanguage(ctx);
    }
    ctx.lang = ctx.session.lang;
    ctx.t = botTranslator(ctx.lang);
    if (!profile.consented) {
      await ack(ctx);
      return say(ctx, ctx.t("start.consent_needed"), [[button(ctx.t("start.consent_button"), "cn:ok")]]);
    }
    return next();
  });
  c.use(select);
  c.use(request);
  c.use(actButtons);
  c.use(info);
  c.use(warranty);
  c.use(myOrders);
  c.on("message", async (ctx) => {
    const isCommand = ctx.message.entities?.some((e) => e.type === "bot_command" && e.offset === 0) === true;
    if (!isCommand && (await relayToTopic(ctx))) return;
    return say(ctx, ctx.t("common.unknown"));
  });
  return c;
}

export function createBot(deps: BotDeps, opts: CreateBotOptions): Bot<BotContext> {
  const bot = new Bot<BotContext>(opts.token, opts.botInfo === undefined ? {} : { botInfo: opts.botInfo });
  const customer = customerComposer(deps);

  bot.use(async (ctx, next) => {
    ctx.deps = deps;
    ctx.answered = false;
    ctx.lang = "uz";
    ctx.t = botTranslator("uz");
    await next();
    // A button is always answered: Telegram shows a spinner on it until it is.
    if (ctx.callbackQuery !== undefined && !ctx.answered) await ack(ctx);
  });

  // Telegram repeats an update that was answered late: every update id is handled once.
  bot.use(async (ctx, next) => {
    if (!(await botRepo.markUpdateProcessed(deps.db, ctx.update.update_id))) return;
    await next();
  });

  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    if (chat === undefined) return;
    if (chat.type === "private") return customer.middleware()(ctx, next);
    // The bot ignores the groups it is put in, except the group of the owner (its id is in the settings).
    if (chat.type === "supergroup" && chat.id === (await ownerGroupId(deps.db))) return staff.middleware()(ctx, next);
  });

  bot.catch(async (err) => {
    deps.log.error({ err: err.error, update: err.ctx.update.update_id }, "bot error");
    try {
      if (err.ctx.chat?.type === "private") await err.ctx.reply(err.ctx.t("common.error"));
    } catch {
      // The chat may have blocked the bot: nothing more to do.
    }
  });
  return bot;
}
