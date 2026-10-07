// The message catalog of the app: static JSON imports, so that bundlers (Next.js) and Node (bot, PDF) read the same files.
// A package writes its namespace files messages/{uz,ru,meta}/<ns>.json; the integrator adds the registration to the lists
// below when the branch is merged (docs/arch/OWNERSHIP.md). repo-messages.test.ts warns about a file on disk that is not
// registered, and fails with NIVEL_STRICT_NAMESPACES=1, which is the check before the merge.

import ruBot from "../messages/ru/bot.json" with { type: "json" };
import ruCommon from "../messages/ru/common.json" with { type: "json" };
import ruCompat from "../messages/ru/compat.json" with { type: "json" };
import ruPdf from "../messages/ru/pdf.json" with { type: "json" };
import ruQuote from "../messages/ru/quote.json" with { type: "json" };
import ruSite from "../messages/ru/site.json" with { type: "json" };
import uzBot from "../messages/uz/bot.json" with { type: "json" };
import uzCommon from "../messages/uz/common.json" with { type: "json" };
import uzCompat from "../messages/uz/compat.json" with { type: "json" };
import uzPdf from "../messages/uz/pdf.json" with { type: "json" };
import uzQuote from "../messages/uz/quote.json" with { type: "json" };
import uzSite from "../messages/uz/site.json" with { type: "json" };
import type { AppLocale } from "./locales.ts";
import type { MessageTree } from "./messages-check.ts";

export type Messages = MessageTree;

const catalog = {
  uz: { bot: uzBot, common: uzCommon, compat: uzCompat, pdf: uzPdf, quote: uzQuote, site: uzSite },
  ru: { bot: ruBot, common: ruCommon, compat: ruCompat, pdf: ruPdf, quote: ruQuote, site: ruSite },
} satisfies Record<AppLocale, Record<string, MessageTree>>;

export type Namespace = keyof (typeof catalog)["uz"];
export const namespaces = Object.keys(catalog.uz) as Namespace[];

function isNamespace(value: string): value is Namespace {
  return (namespaces as readonly string[]).includes(value);
}

/**
 * Messages of one or several namespaces, nested under the namespace name (the layout next-intl expects):
 * getMessages("uz", "common") → { common: { ... } }.
 */
export function getMessages(
  locale: AppLocale,
  ns: Namespace | readonly Namespace[] = ["common"],
): Record<string, Messages> {
  const wanted: readonly string[] = typeof ns === "string" ? [ns] : ns;
  return Object.fromEntries(
    wanted.map((name) => {
      if (!isNamespace(name)) throw new Error(`Unknown namespace "${name}"; registered: ${namespaces.join(", ")}`);
      return [name, catalog[locale][name]];
    }),
  );
}
