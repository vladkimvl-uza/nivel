import type { AppLocale, NodeTranslator } from "@nivel/i18n";
import type { Context, SessionFlavor } from "grammy";
import type { BotDeps } from "./deps.ts";
import type { Session } from "./session.ts";

/** What the middleware puts on every update. */
export interface BotFlavor {
  deps: BotDeps;
  /** The language of the answers: the session, else the profile, else Uzbek (it comes first). */
  lang: AppLocale;
  t: NodeTranslator;
  /** True once the update of a button was answered (the first answer wins, Telegram takes one). */
  answered: boolean;
  /** Set in the owner's group: who is writing there. */
  staff?: "owner" | "assistant";
}

export type BotContext = Context & SessionFlavor<Session> & BotFlavor;
