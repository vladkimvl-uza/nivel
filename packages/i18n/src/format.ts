// Formatters for money, dates and time (ARCHITECTURE 5.2). Money is whole sums only; dates and times are in Asia/Tashkent.
import type { AppLocale } from "./locales.ts";
import { assertLocale } from "./locales.ts";

const NBSP = " ";
const MINUS = "−";
const SUM_UNIT: Record<AppLocale, string> = { uz: "soʻm", ru: "сум" };

/**
 * "12 500 000 soʻm": groups of three and the unit are separated by non-breaking spaces. Takes a whole number of sums;
 * there is no currency parameter, sums are the only currency of the platform.
 */
export function formatSum(sum: number, locale: AppLocale): string {
  assertLocale(locale);
  if (typeof sum !== "number") throw new TypeError(`formatSum expects a number of sums, got ${typeof sum}`);
  if (!Number.isSafeInteger(sum)) throw new RangeError(`formatSum expects a whole number of sums, got ${sum}`);
  const digits = String(Math.abs(sum)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sum < 0 ? MINUS : ""}${digits}${NBSP}${SUM_UNIT[locale]}`;
}

const TASHKENT = "Asia/Tashkent";
const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TASHKENT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isCalendarDate(yyyy: string, mm: string, dd: string): boolean {
  const probe = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return (
    probe.getUTCFullYear() === Number(yyyy) &&
    probe.getUTCMonth() === Number(mm) - 1 &&
    probe.getUTCDate() === Number(dd)
  );
}

/** V8 silently rolls 2026-02-30T10:00Z over to March and 24:00 to the next day; here they are errors. */
function assertRealTimestamp(value: string, m: RegExpExecArray): void {
  const [, yyyy = "", mm = "", dd = "", hh = "", min = "", ss = "00", offH = "00", offM = "00"] = m;
  if (
    !isCalendarDate(yyyy, mm, dd) ||
    Number(hh) > 23 ||
    Number(min) > 59 ||
    Number(ss) > 59 ||
    Number(offH) > 23 ||
    Number(offM) > 59
  ) {
    throw new RangeError(`"${value}" is not a real calendar date and time`);
  }
}

interface Wall {
  dd: string;
  mm: string;
  yyyy: string;
  hh: string;
  min: string;
}

function wallClock(value: Date | string, needTime: boolean): Wall {
  if (typeof value === "string") {
    const dateOnly = DATE_ONLY.exec(value);
    if (dateOnly) {
      if (needTime) throw new RangeError(`"${value}" has no time of day`);
      const [, yyyy, mm, dd] = dateOnly as unknown as [string, string, string, string];
      if (!isCalendarDate(yyyy, mm, dd)) throw new RangeError(`"${value}" is not a calendar date`);
      return { dd, mm, yyyy, hh: "00", min: "00" };
    }
    const stamp = WITH_OFFSET.exec(value);
    if (!stamp) {
      throw new RangeError(`"${value}" is not an ISO date (yyyy-mm-dd) or a timestamp with an explicit offset`);
    }
    assertRealTimestamp(value, stamp);
  } else if (!(value instanceof Date)) {
    throw new TypeError("expected a Date or an ISO string");
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid date");
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return { dd: parts.day, mm: parts.month, yyyy: parts.year, hh: parts.hour, min: parts.minute } as Wall;
}

/** "02.11.2026" in Asia/Tashkent. A plain "yyyy-mm-dd" is taken as is, a timestamp must carry its offset. */
export function formatDate(value: Date | string, locale: AppLocale): string {
  assertLocale(locale);
  const w = wallClock(value, false);
  return `${w.dd}.${w.mm}.${w.yyyy}`;
}

/** "14:30" (24 hours) in Asia/Tashkent. */
export function formatTime(value: Date | string, locale: AppLocale): string {
  assertLocale(locale);
  const w = wallClock(value, true);
  return `${w.hh}:${w.min}`;
}
