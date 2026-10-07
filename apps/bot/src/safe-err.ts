// What the log keeps of an error. An error of grammY holds the whole request that failed (`payload`: the secret of the
// webhook, the texts of the cards with the address of a customer) and the error it came from; pino would print all of
// it. Here only the method, the code and the words of Telegram stay, and a token of the bot is hidden wherever it is.
import { GrammyError, HttpError } from "grammy";
import pino from "pino";

const TOKEN = /bot\d{5,}:[A-Za-z0-9_-]{20,}/g;
const hide = (text: string): string => text.replace(TOKEN, "bot<token>");

export function safeErr(err: unknown): unknown {
  if (err instanceof GrammyError) {
    return {
      type: "GrammyError",
      message: hide(err.message),
      method: err.method,
      error_code: err.error_code,
      description: err.description,
    };
  }
  if (err instanceof HttpError) return { type: "HttpError", message: hide(err.message) };
  if (typeof err !== "object" || err === null) return err;
  const plain = pino.stdSerializers.err(err as Error);
  if (typeof plain.message === "string") plain.message = hide(plain.message);
  if (typeof plain.stack === "string") plain.stack = hide(plain.stack);
  return plain;
}
