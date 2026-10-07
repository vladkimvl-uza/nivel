// Small helpers to answer: a message with rows of inline buttons, a toast for a button, the removal of a keyboard.
import { type InlineButton, keyboardMarkup } from "@nivel/telegram";
import type { BotContext } from "./context.ts";

export type Rows = readonly (readonly InlineButton[])[];

export const button = (text: string, callbackData: string): InlineButton => ({ text, callbackData });

/** One message to the chat of the update, with optional rows of inline buttons. */
export function say(ctx: BotContext, text: string, rows: Rows = []) {
  const markup = keyboardMarkup(rows);
  return ctx.reply(text, markup === undefined ? {} : { reply_markup: markup });
}

/** Answers the press of a button once (Telegram takes one answer); the text, if any, is a toast. */
export async function ack(ctx: BotContext, text?: string, alert = false): Promise<void> {
  if (ctx.callbackQuery === undefined || ctx.answered) return;
  ctx.answered = true;
  await ctx.answerCallbackQuery(text === undefined ? {} : { text, show_alert: alert });
}

/** Takes the buttons off the message that carried the pressed button (it must not be pressed twice). */
export async function clearButtons(ctx: BotContext): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    // The message may be too old or already edited: the buttons are harmless then, every press is checked again.
  }
}
