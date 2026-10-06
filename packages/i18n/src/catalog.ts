// The message catalog of the app: static JSON imports, so that bundlers (Next.js) and Node (bot, PDF) read the same files.
// A new namespace file messages/{uz,ru,meta}/<ns>.json is added to the lists below in the same change (repo-messages.test.ts
// fails when a file on disk is not registered).

import ruCommon from "../messages/ru/common.json" with { type: "json" };
import uzCommon from "../messages/uz/common.json" with { type: "json" };
import type { AppLocale } from "./locales.ts";
import type { MessageTree } from "./messages-check.ts";

export type Messages = MessageTree;

const catalog = {
  uz: { common: uzCommon },
  ru: { common: ruCommon },
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
