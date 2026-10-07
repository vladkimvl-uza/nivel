// A fake Bot API for the tests (no network): `bot.api.config.use` answers every call, and the calls are kept to be read.
// Updates are built here too, so that a test says "this person wrote that" and reads what the bot did.
import type { Bot, Context } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

export interface Call {
  method: string;
  payload: Record<string, unknown>;
}

export interface Person {
  id: number;
  first_name: string;
  username?: string;
  language_code?: string;
}

export const BOT_INFO: UserFromGetMe = {
  id: 9_000_000_001,
  is_bot: true,
  first_name: "Nivel test",
  username: "niveluz_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

// Update ids are global to the run: the bot remembers them in the database, and every test brings its own bot.
let updateId = 5000;
// Topic ids are global to the run too: the bot keeps them in the requests of the database, shared by the tests of a file.
let topicId = 300;

/** The inline buttons of a call (sendMessage, editMessageReplyMarkup): text and callback_data, flat. */
export function inlineButtons(call: Call | undefined): { text: string; callback_data: string }[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: { text: string; callback_data: string }[][] }
    | undefined;
  return (markup?.inline_keyboard ?? []).flat();
}

type Failure = { error_code: number; description: string };

export class FakeTelegram {
  readonly calls: Call[] = [];
  private messageId = 1000;
  private readonly failures = new Map<string, Failure[]>();

  /** Installs the fake on a bot: nothing leaves the process. */
  install<C extends Context>(bot: Bot<C>): void {
    bot.api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      this.calls.push({ method, payload: p });
      const queue = this.failures.get(method);
      const failure = queue?.shift();
      if (failure) return { ok: false, ...failure } as never;
      return { ok: true, result: this.result(method, p) } as never;
    });
  }

  /** The next call of `method` fails the way Telegram refuses (403 when the user blocked the bot). */
  failNext(
    method: string,
    failure: Failure = { error_code: 403, description: "Forbidden: bot was blocked by the user" },
  ) {
    const queue = this.failures.get(method) ?? [];
    queue.push(failure);
    this.failures.set(method, queue);
  }

  private result(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument":
        this.messageId += 1;
        return {
          message_id: this.messageId,
          date: 1_790_000_000,
          chat: { id: p.chat_id, type: "private" },
          ...(typeof p.text === "string" ? { text: p.text } : {}),
          ...(p.message_thread_id === undefined ? {} : { message_thread_id: p.message_thread_id }),
        };
      case "copyMessage":
        this.messageId += 1;
        return { message_id: this.messageId };
      case "createForumTopic":
        topicId += 1;
        return { message_thread_id: topicId, name: p.name, icon_color: 7322096 };
      case "getFile":
        return {
          file_id: p.file_id,
          file_unique_id: `u-${String(p.file_id)}`,
          file_path: `photos/${String(p.file_id)}.jpg`,
        };
      case "getMe":
        return BOT_INFO;
      case "editMessageText":
      case "editMessageReplyMarkup":
        return { message_id: p.message_id, date: 1_790_000_000, chat: { id: p.chat_id, type: "private" } };
      default:
        return true;
    }
  }

  /** Calls of one method, in order. */
  of(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** The texts the bot sent to one chat (sendMessage), in order. */
  textsTo(chatId: number, threadId?: number): string[] {
    return this.of("sendMessage")
      .filter(
        (c) => c.payload.chat_id === chatId && (threadId === undefined || c.payload.message_thread_id === threadId),
      )
      .map((c) => String(c.payload.text));
  }

  lastSend(chatId: number): Call | undefined {
    return this.of("sendMessage")
      .filter((c) => c.payload.chat_id === chatId)
      .at(-1);
  }

  /** callback_data of every inline button the bot has shown so far. */
  allCallbackData(): string[] {
    return this.calls.flatMap((c) => {
      const markup = c.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;
      return (markup?.inline_keyboard ?? [])
        .flat()
        .flatMap((b) => (b.callback_data === undefined ? [] : [b.callback_data]));
    });
  }

  reset(): void {
    this.calls.length = 0;
  }

  // ---- updates -------------------------------------------------------------------------------------------------
  private nextUpdateId(): number {
    updateId += 1;
    return updateId;
  }

  private nextMessageId(): number {
    this.messageId += 1;
    return this.messageId;
  }

  /** A text (or a message with the given fields) from `from` in the private chat with the bot. */
  privateMessage(from: Person, fields: Record<string, unknown> = {}): Update {
    return {
      update_id: this.nextUpdateId(),
      message: {
        message_id: this.nextMessageId(),
        date: 1_790_000_000,
        chat: { id: from.id, type: "private", first_name: from.first_name },
        from: { ...from, is_bot: false },
        ...fields,
      },
    } as Update;
  }

  text(from: Person, text: string): Update {
    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/.exec(text);
    return this.privateMessage(from, {
      text,
      ...(command
        ? { entities: [{ type: "bot_command", offset: 0, length: (command[0] as string).trim().length }] }
        : {}),
    });
  }

  contact(from: Person, phone: string): Update {
    return this.privateMessage(from, {
      contact: { phone_number: phone, first_name: from.first_name, user_id: from.id },
    });
  }

  /** A message in a topic of the group (or in the General topic when `threadId` is undefined). */
  groupMessage(chatId: number, from: Person, fields: Record<string, unknown>, threadId?: number): Update {
    return {
      update_id: this.nextUpdateId(),
      message: {
        message_id: this.nextMessageId(),
        date: 1_790_000_000,
        chat: { id: chatId, type: "supergroup", title: "Nivel owner", is_forum: true },
        from: { ...from, is_bot: false },
        ...(threadId === undefined ? {} : { message_thread_id: threadId, is_topic_message: true }),
        ...fields,
      },
    } as Update;
  }

  /** The press of an inline button under a message the bot sent (`messageId` is the id of that message). */
  press(from: Person, chatId: number, messageId: number, data: string, threadId?: number): Update {
    return {
      update_id: this.nextUpdateId(),
      callback_query: {
        id: `cb-${updateId}`,
        from: { ...from, is_bot: false },
        chat_instance: "ci",
        data,
        message: {
          message_id: messageId,
          date: 1_790_000_000,
          chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private" },
          ...(threadId === undefined ? {} : { message_thread_id: threadId }),
        },
      },
    } as Update;
  }
}
