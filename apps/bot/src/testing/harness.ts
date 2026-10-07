// The bot of the tests: the real handlers on the real (throwaway) database, the fake Bot API in place of Telegram.
import { type CreateBotOptions, createBot } from "../bot.ts";
import type { BotDeps } from "../deps.ts";
import { BOT_INFO, FakeTelegram, type Person } from "./fake-telegram.ts";
import type { BotWorld } from "./world.ts";

/** Made up for the tests: it names no bot. */
export const TEST_TOKEN = "123456:TEST-token-of-the-bot-tests"; // gitleaks:allow made-up value, never a real bot token

export const ALI: Person = { id: 7_100_000_001, first_name: "Ali", username: "ali_uz", language_code: "uz" };
export const DILYA: Person = { id: 7_100_000_002, first_name: "Dilya", username: "dilya", language_code: "ru" };
export const OWNER: Person = { id: 6_001_000_001, first_name: "Vlad", username: "owner" };
export const ASSISTANT: Person = { id: 6_001_000_002, first_name: "Helper", username: "helper" };
let people = 7_200_000_000;
/** A new person with an id nobody else in the run has. */
export function newPerson(first_name: string, username: string, language_code: "uz" | "ru" = "uz"): Person {
  people += 1;
  return { id: people, first_name, username, language_code };
}

export const STRANGER: Person = { id: 6_999_000_009, first_name: "Stranger", username: "stranger" };

type TestBot = ReturnType<typeof createBot>;

export interface Harness {
  bot: TestBot;
  tg: FakeTelegram;
  deps: BotDeps;
  /**
   * Sends an update to the bot and waits for the handlers. An error the bot logged fails the test, unless the test says
   * it expects one (`allowErrors`): then the logged errors are returned.
   */
  send(update: Parameters<TestBot["handleUpdate"]>[0], opts?: { allowErrors?: boolean }): Promise<unknown[][]>;
}

export function createHarness(
  w: BotWorld,
  o: Partial<BotDeps> = {},
  botOptions: Partial<CreateBotOptions> = {},
): Harness {
  const tg = new FakeTelegram();
  const errors: unknown[][] = [];
  const deps: BotDeps = {
    db: w.bot.db,
    rt: w.bot,
    now: w.clock.now,
    appMode: w.bot.appMode,
    ownerIds: [String(w.owner.telegramId)],
    publicBaseUrl: "https://nivel.test",
    log: {
      info() {},
      warn() {},
      error: (...args: unknown[]) => {
        errors.push(args);
      },
    },
    ...o,
  };
  // The tests send many updates of one person in a moment: the limit is off unless a test asks for it.
  const bot = createBot(deps, { token: TEST_TOKEN, botInfo: BOT_INFO, throttle: false, ...botOptions });
  tg.install(bot);
  return {
    bot,
    tg,
    deps,
    // An error the bot caught and logged would hide behind its apology to the customer: the test must see it.
    async send(update, opts = {}) {
      await bot.handleUpdate(update);
      const seen = errors.splice(0, errors.length);
      if (seen.length > 0 && opts.allowErrors !== true) {
        const first = (seen[0]?.[0] as { err?: { stack?: string } } | undefined)?.err;
        throw new Error(`the bot logged an error: ${first?.stack ?? JSON.stringify(seen)}`);
      }
      return seen;
    },
  };
}

/** The road of a new customer: /start, the language, the consent. After it the bot shows the menu. */
export async function onboard(h: Harness, person: Person, lang: "uz" | "ru" = "uz"): Promise<void> {
  await h.send(h.tg.text(person, "/start"));
  await h.send(h.tg.press(person, person.id, 1001, `lg:${lang}`));
  await h.send(h.tg.press(person, person.id, 1002, "cn:ok"));
}

/** The buttons (text, callback_data) of the last message the bot sent to a chat. */
export function lastButtons(h: Harness, chatId: number): [string, string][] {
  const markup = h.tg.lastSend(chatId)?.payload.reply_markup as
    | { inline_keyboard: { text: string; callback_data: string }[][] }
    | undefined;
  return (markup?.inline_keyboard ?? []).flat().map((b) => [b.text, b.callback_data]);
}
