// The Bot API as far as the worker uses it: sendMessage and getWebhookInfo, by plain fetch (the bot of WP-13 has grammY; the
// worker needs two calls and no dependency). The token is in the URL, so no error, log or record may carry the URL: a failure
// is rebuilt here from the status and the description of Telegram alone.
import type { SendMessageInput, TelegramGateway } from "./runtime.ts";

const API = "https://api.telegram.org";
const MAX_TEXT = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;

/** A call to Telegram that did not succeed. `status` is the HTTP status, `null` when there was no answer at all. */
export class TelegramError extends Error {
  readonly status: number | null;
  /** The pause Telegram asks for after 429. */
  readonly retryAfterSec: number | null;
  constructor(message: string, status: number | null, retryAfterSec: number | null = null) {
    super(message);
    this.name = "TelegramError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface TelegramOptions {
  token: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

interface ApiAnswer<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export function createTelegramGateway(o: TelegramOptions): TelegramGateway {
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await o.fetch(`${API}/bot${o.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // The message of a network error can name the URL, and the URL holds the token: say only what kind of failure it was.
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new TelegramError(aborted ? `${method}: timeout` : `${method}: network error`, null);
    } finally {
      clearTimeout(timer);
    }
    let answer: ApiAnswer<T> | null = null;
    try {
      answer = (await response.json()) as ApiAnswer<T>;
    } catch {
      answer = null;
    }
    if (!response.ok || answer?.ok !== true || answer.result === undefined) {
      const description = (answer?.description ?? "no description").replaceAll(o.token, "<token>");
      throw new TelegramError(
        `${method}: HTTP ${response.status}: ${description}`,
        response.status,
        answer?.parameters?.retry_after ?? null,
      );
    }
    return answer.result;
  }

  return {
    enabled: true,
    async sendMessage(input: SendMessageInput) {
      const text = input.text.length > MAX_TEXT ? `${input.text.slice(0, MAX_TEXT - 1)}…` : input.text;
      const result = await call<{ message_id: number }>("sendMessage", {
        chat_id: input.chatId,
        text,
        ...(input.threadId === undefined ? {} : { message_thread_id: input.threadId }),
        link_preview_options: { is_disabled: true },
      });
      return { messageId: result.message_id };
    },
    async getWebhookInfo() {
      const r = await call<{ url?: string; last_error_date?: number; last_error_message?: string }>(
        "getWebhookInfo",
        {},
      );
      return {
        url: r.url ?? "",
        lastErrorDate: r.last_error_date ?? null,
        lastErrorMessage: r.last_error_message ?? null,
      };
    },
  };
}

/** Without BOT_TOKEN: nothing is sent (CLAUDE.md: the bot says "disabled: no BOT_TOKEN"). */
export const disabledTelegram: TelegramGateway = {
  enabled: false,
  async sendMessage() {
    throw new Error("Telegram is disabled: no BOT_TOKEN");
  },
  async getWebhookInfo() {
    throw new Error("Telegram is disabled: no BOT_TOKEN");
  },
};
