// The messages of the bot (namespace `bot`, packages/i18n/messages/{uz,ru}/bot.json) behind one translator per language.
// The JSON files are imported here directly, so that the bot and the worker read the same texts before the integrator
// registers the namespace in packages/i18n/src/catalog.ts (docs/arch/OWNERSHIP.md); after that this stays correct.
import { type AppLocale, createNodeTranslator, isLocale, type Messages, type NodeTranslator } from "@nivel/i18n";
import ru from "@nivel/i18n/messages/ru/bot.json" with { type: "json" };
import uz from "@nivel/i18n/messages/uz/bot.json" with { type: "json" };

const CATALOG: Record<AppLocale, Record<string, Messages>> = {
  uz: { bot: uz as Messages },
  ru: { bot: ru as Messages },
};

const cache = new Map<AppLocale, NodeTranslator>();

/** `botTranslator("uz")("menu.select")`; a missing key or argument throws (a raw key never reaches a customer). */
export function botTranslator(lang: AppLocale): NodeTranslator {
  let t = cache.get(lang);
  if (t === undefined) {
    t = createNodeTranslator(lang, "bot", CATALOG[lang]);
    cache.set(lang, t);
  }
  return t;
}

/** The language of a customer: only uz and ru exist, and Uzbek comes first when nothing is known. */
export function langOf(value: unknown): AppLocale {
  return isLocale(value) ? value : "uz";
}
