// Number words of the site text: "26,83 млн", "20 mln", "140 000 сум". Whole sums only, no floating point.
import { type AppLocale, formatSum } from "@nivel/i18n";

const NBSP = " ";
const UNIT_MLN: Record<AppLocale, string> = { uz: "mln", ru: "млн" };

/** A whole number of sums with the unit of the language: "12 500 000 soʻm" (the formatter of @nivel/i18n). */
export function formatSumsOf(sum: number, locale: AppLocale): string {
  return formatSum(sum, locale);
}

/**
 * Millions with a decimal comma: 2 250 000 → "2,25 млн". A sum that is not a whole number of thousands cannot be
 * written that short without rounding, so it is written in full.
 */
export function formatMln(sum: number, locale: AppLocale): string {
  if (!Number.isSafeInteger(sum) || sum < 0)
    throw new RangeError("formatMln expects a whole non-negative number of sums");
  if (sum % 1000 !== 0) return formatSum(sum, locale);
  const whole = Math.floor(sum / 1_000_000);
  const fraction = String(sum % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${fraction === "" ? whole : `${whole},${fraction}`}${NBSP}${UNIT_MLN[locale]}`;
}
