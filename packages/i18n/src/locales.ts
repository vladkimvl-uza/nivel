export const locales = ["uz", "ru"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "uz";
/** <html lang>: Uzbek in Latin script. */
export const htmlLang: Record<AppLocale, string> = { uz: "uz-Latn", ru: "ru" };

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function assertLocale(value: unknown): asserts value is AppLocale {
  if (!isLocale(value)) throw new TypeError(`Unsupported locale ${JSON.stringify(value)}; expected uz or ru`);
}
