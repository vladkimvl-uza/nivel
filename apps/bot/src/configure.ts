// What the bot tells Telegram about itself at the start (ARCHITECTURE 7.2 «Старт и язык»): the commands and the
// descriptions in both languages; Uzbek is the default for the people whose language is neither (it comes first).
import { botCommands, botProfile } from "@nivel/telegram";
import type { Api } from "grammy";

export async function configureBot(api: Api): Promise<void> {
  const profile = (lang: "uz" | "ru", code?: "uz" | "ru") => ({
    lang,
    other: code === undefined ? {} : { language_code: code },
  });
  // The default (no language code) first, then each language.
  for (const { lang, other } of [profile("uz"), profile("uz", "uz"), profile("ru", "ru")]) {
    const text = botProfile(lang);
    await api.setMyCommands(botCommands(lang), other);
    await api.setMyShortDescription(text.shortDescription, other);
    await api.setMyDescription(text.description, other);
  }
}
