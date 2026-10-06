// Translator for places without React: the Telegram bot and PDF documents (ARCHITECTURE 5.2, 7.1). It uses the same ICU
// messages and the same engine (use-intl) as the site. A missing key or argument throws: a raw key must never reach a customer.
import { createTranslator } from "use-intl/core";
import { getMessages, type Messages } from "./catalog.ts";
import type { AppLocale } from "./locales.ts";
import { assertLocale } from "./locales.ts";

export type TranslationValues = Record<string, string | number | boolean | Date | null | undefined>;

export interface NodeTranslator {
  (key: string, values?: TranslationValues): string;
  has(key: string): boolean;
}

/**
 * `createNodeTranslator("uz", "bot")("start.greeting", { name })`. `messages` replaces the catalog (tests, previews); it has
 * the layout of getMessages: namespaces at the top level.
 */
export function createNodeTranslator(
  locale: AppLocale,
  namespace: string,
  messages?: Record<string, Messages>,
): NodeTranslator {
  assertLocale(locale);
  const t = createTranslator({
    locale,
    namespace,
    messages: messages ?? getMessages(locale, namespace as never),
    timeZone: "Asia/Tashkent",
    onError(error: Error) {
      throw error;
    },
  } as never) as unknown as {
    (key: string, values?: TranslationValues): string;
    has(key: string): boolean;
  };
  const translate = ((key: string, values?: TranslationValues) => t(key, values)) as NodeTranslator;
  translate.has = (key) => t.has(key);
  return translate;
}
