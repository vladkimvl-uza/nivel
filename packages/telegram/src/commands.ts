// Commands and the profile texts of the bot in both languages (setMyCommands, setMyDescription: ARCHITECTURE 7.2).
import type { AppLocale } from "@nivel/i18n";
import { botTranslator } from "./messages.ts";

export const BOT_COMMANDS = ["start", "language", "order", "support", "terms", "privacy", "stop"] as const;
export type BotCommand = (typeof BOT_COMMANDS)[number];

export function botCommands(lang: AppLocale): { command: BotCommand; description: string }[] {
  const t = botTranslator(lang);
  return BOT_COMMANDS.map((command) => ({ command, description: t(`cmd.${command}`) }));
}

export function botProfile(lang: AppLocale): { shortDescription: string; description: string } {
  const t = botTranslator(lang);
  return { shortDescription: t("profile.short"), description: t("profile.description") };
}
