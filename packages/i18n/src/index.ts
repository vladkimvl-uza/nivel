// ICU messages uz/ru per namespace + meta for the translator (ARCHITECTURE 5.2). Owner after WP-00 — WP-08.
import ruCommon from "../messages/ru/common.json" with { type: "json" };
import uzCommon from "../messages/uz/common.json" with { type: "json" };

export const locales = ["uz", "ru"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "uz";
/** <html lang>: Uzbek in Latin script. */
export const htmlLang: Record<AppLocale, string> = { uz: "uz-Latn", ru: "ru" };

export type Namespace = "common";
export type Messages = typeof uzCommon;

const catalog: Record<AppLocale, Record<Namespace, Messages>> = {
  uz: { common: uzCommon },
  ru: { common: ruCommon },
};

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Messages of one namespace; next-intl nests them under the namespace key. */
export function getMessages(
  locale: AppLocale,
  namespaces: readonly Namespace[] = ["common"],
): Record<string, Messages> {
  return Object.fromEntries(namespaces.map((ns) => [ns, catalog[locale][ns]]));
}
