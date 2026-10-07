import { isLocale } from "@nivel/i18n";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing.ts";
import { loadMessages } from "./site-messages.ts";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  return { locale, messages: loadMessages(locale), timeZone: "Asia/Tashkent" };
});
