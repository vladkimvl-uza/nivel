import { getMessages, isLocale } from "@nivel/i18n";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing.ts";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  return { locale, messages: getMessages(locale), timeZone: "Asia/Tashkent" };
});
