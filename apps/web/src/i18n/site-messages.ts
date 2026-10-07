// The messages of the namespace `site` (packages/i18n/messages/{uz,ru}/site.json). The catalog of @nivel/i18n gets the
// namespace when the integrator registers it (docs/arch/OWNERSHIP.md, "Реестр пространств имён"); until then the site reads the
// files itself, and after the registration the catalog is used and this fallback stays unused.
import { type AppLocale, getMessages, type Messages, namespaces } from "@nivel/i18n";
import ruSite from "@nivel/i18n/messages/ru/site.json" with { type: "json" };
import uzSite from "@nivel/i18n/messages/uz/site.json" with { type: "json" };

const own: Record<AppLocale, Messages> = { uz: uzSite, ru: ruSite };

/** `{ common, site }` of the language, in the layout next-intl wants. */
export function loadMessages(locale: AppLocale): Record<string, Messages> {
  const registered = (namespaces as readonly string[]).includes("site");
  if (registered) return getMessages(locale, ["common", "site"] as never) as Record<string, Messages>;
  return { ...getMessages(locale, "common"), site: own[locale] };
}
