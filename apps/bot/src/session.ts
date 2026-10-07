// The session of a private chat (ARCHITECTURE 7.1: `bot.sessions`, an adapter over the repositories of the database):
// the step of the dialog, the language and the draft of the request. Nothing here is a fact about money or an order:
// the facts are read from the database every time.

import type { Db } from "@nivel/db";
import { bot as botRepo } from "@nivel/db/repos";
import type { AppLocale } from "@nivel/i18n";
import type { StorageAdapter } from "grammy";
import type { Step } from "./steps.ts";

export interface Draft {
  task?: string;
  band?: string;
  scope?: string;
  wishes: string[];
  /** The build the customer picked: the key of the template (task, tier, style) and the title shown to him. */
  build?: { task: string; tier: string; style: string; title: string };
  phone?: string;
  district?: string;
  /** The order the next free text is about (a question about the report, a report of a problem). */
  orderNumber?: string;
  /** The text of a report of a problem, collected over several messages. */
  warrantyParts?: { text: string; photoFileIds: string[]; messageIds: number[] };
}

export interface Session {
  lang?: AppLocale;
  step: Step;
  draft: Draft;
  /** The newest answer of the database about the consent pd_processing; asked again when it is false. */
  consented: boolean;
  /** When the automatic answer outside the hours was last sent (once in six hours is enough). */
  lastAutoReplyAt?: string;
}

export const initialSession = (): Session => ({ step: "idle", draft: { wishes: [] }, consented: false });

/** The key of the session of a private chat: the Telegram id is the chat id there. */
export const sessionKey = (chatId: number): string => `private:${chatId}`;

export function dbStorage(db: Db): StorageAdapter<Session> {
  return {
    async read(key) {
      const value = await botRepo.getSession(db, key);
      return value === null ? undefined : (value as unknown as Session);
    },
    async write(key, value) {
      await botRepo.saveSession(db, key, value as unknown as Record<string, unknown>);
    },
    async delete(key) {
      await botRepo.deleteSession(db, key);
    },
  };
}
