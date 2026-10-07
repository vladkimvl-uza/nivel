import { defaultLocale, locales } from "@nivel/i18n";
import { defineRouting } from "next-intl/routing";

// uz first, ru second; the prefix is always present so links from the bot and ads never change (ARCHITECTURE 5.1–5.2).
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  // hreflang comes from the metadata of the pages (x-default is the Uzbek page, not the root that redirects to it)
  alternateLinks: false,
});
