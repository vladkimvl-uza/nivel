// The bot (ARCHITECTURE 7): one program, one client bot and the closed group of the owner. Updates go through three gates:
// each is handled once (`bot.processed_updates`), groups other than the owner's are not answered, and the private chat
// has a session (`bot.sessions`) and a customer who has agreed before anything else is done.

import { sequentialize } from "@grammyjs/runner";
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
import { createThrottle, type ThrottleOptions } from "./throttle.ts";
import { ack, button, say } from "./ui.ts";

export interface CreateBotOptions {
  token: string;
  /** With the data of the bot Telegram is not asked `getMe` before the first update (tests and webhooks). */
  botInfo?: UserFromGetMe;
  /** How often one person may write (ARCHITECTURE 10.1); `false` for the tests that send many updates in a moment. */
  throttle?: ThrottleOptions | false;
}

/** A burst of eight (a person taps through the menu) and one update a second after that. */
export const DEFAULT_THROTTLE: ThrottleOptions = { burst: 8, perSecond: 1 };

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

  // The updates of one chat go one after the other, in every mode: a double tap must not pass the same check twice
  // (two consents, two acceptances) and two writes of the session must not overwrite each other.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  bot.use(async (ctx, next) => {
    ctx.deps = deps;
    ctx.answered = false;
    ctx.lang = "uz";
    ctx.t = botTranslator("uz");
    // Whatever the mode (polling, webhook), a failure of a handler is logged here and the customer is not left in silence.
    try {
      await next();
      // A button is always answered: Telegram shows a spinner on it until it is.
      if (ctx.callbackQuery !== undefined && !ctx.answered) await ack(ctx);
    } catch (err) {
      deps.log.error({ err, update: ctx.update.update_id }, "bot error");
      try {
        if (ctx.chat?.type === "private") await ctx.reply(ctx.t("common.error"));
      } catch {
        // The chat may have blocked the bot: nothing more to do.
      }
    }
  });

  // Before the database is touched: more than the limit from one person is dropped (the owner is not limited).
  const throttle = opts.throttle === false ? undefined : createThrottle(opts.throttle ?? DEFAULT_THROTTLE);
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (throttle === undefined || id === undefined || deps.ownerIds.includes(String(id))) return next();
    const verdict = throttle.take(String(id));
    if (verdict === "ok") return next();
    if (ctx.callbackQuery !== undefined) await ack(ctx);
    if (verdict === "notice" && ctx.chat?.type === "private") await ctx.reply(ctx.t("common.slow_down"));
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

  // Only what escapes the first middleware (it cannot, but a bot that is silent about it is worse).
  bot.catch((err) => deps.log.error({ err: err.error }, "bot error outside the handlers"));
  return bot;
}
