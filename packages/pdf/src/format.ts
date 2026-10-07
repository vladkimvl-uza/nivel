// Numbers and dates the way the documents write them: whole sums with a non-breaking space between thousands (@nivel/ui),
// dates and times in Asia/Tashkent (@nivel/i18n).
import { formatDate, formatSum, formatTime } from "@nivel/i18n";
import { formatAmount, formatBp } from "@nivel/ui";
import { whole } from "./guards.ts";
import type { PdfLang } from "./types.ts";

/** "12 500 000": a table cell, the unit is in the heading of the column. */
export const amount = (n: number): string => formatAmount(whole("sum", n));

/** "12 500 000 soʻm". */
export const money = (n: number, lang: PdfLang): string => formatSum(whole("sum", n), lang);

/** "15 %". */
export const rate = (bp: number): string => formatBp(whole("rate", bp));

/** "05.10.2026" from a day or a timestamp. */
export const day = (value: string, lang: PdfLang): string => formatDate(value, lang);

/** "05.10.2026 15:02" in Tashkent from a timestamp. */
export const stampOf = (value: string, lang: PdfLang): string =>
  `${formatDate(value, lang)} ${formatTime(value, lang)}`;
