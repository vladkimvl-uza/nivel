// Translator for places without React: the Telegram bot and PDF documents (ARCHITECTURE 5.2, 7.1). It uses the same ICU
// messages and the same engine (use-intl) as the site. A missing key or argument throws: a raw key must never reach a customer.
import { createTranslator } from "use-intl/core";
import { getMessages, type Messages } from "./catalog.ts";
import type { AppLocale } from "./locales.ts";
import { assertLocale } from "./locales.ts";

/** Same as use-intl: no booleans, null or undefined. A value that is "not there" must be an error, not an empty text. */
export type TranslationValues = Record<string, string | number | Date>;

export interface NodeTranslator {
  (key: string, values?: TranslationValues): string;
  has(key: string): boolean;
}

/** use-intl turns undefined, null and false into "" or 0 (and NaN into "NaN"); a customer must never see that. */
function assertUsableValues(key: string, values: TranslationValues): void {
  for (const [name, value] of Object.entries(values)) {
    const ok =
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (value instanceof Date && !Number.isNaN(value.getTime()));
    if (!ok) throw new TypeError(`Value of "${name}" for message "${key}" is not usable (${String(value)})`);
  }
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
  // The namespace is a plain string here: a test may supply one that is not registered, through `messages`.
  const t = createTranslator({
    locale,
    namespace,
    messages: messages ?? getMessages(locale, namespace as never),
    timeZone: "Asia/Tashkent",
    onError(error: Error) {
      throw error;
    },
  } as Parameters<typeof createTranslator>[0]) as unknown as NodeTranslator;
  const translate = ((key: string, values?: TranslationValues) => {
    // Always pass an object: the production build of use-intl returns the raw ICU template when `values` is falsy,
    // without compiling it, so a forgotten {name} would reach the customer in plain Node (but not under Vitest).
    const given = values ?? {};
    assertUsableValues(key, given);
    return t(key, given);
  }) as NodeTranslator;
  translate.has = (key) => t.has(key);
  return translate;
}
