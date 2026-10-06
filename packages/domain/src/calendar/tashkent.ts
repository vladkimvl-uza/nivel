// Asia/Tashkent is UTC+5 all year (no daylight saving since 1991), so local time is plain millisecond arithmetic.
import type { IsoDate } from "../money/types.ts";

export const TASHKENT_OFFSET_MS = 5 * 3_600_000;
export const DAY_MS = 86_400_000;

function assertDate(d: Date, fn: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new RangeError(`${fn}: invalid Date`);
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** The date on the wall in Tashkent at instant `d`. */
export function isoDateInTashkent(d: Date): IsoDate {
  assertDate(d, "isoDateInTashkent");
  const local = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  return `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1, 2)}-${pad(local.getUTCDate(), 2)}`;
}

/** Wall clock hour and minute in Tashkent at instant `d`. */
export function tashkentTime(d: Date): { hour: number; minute: number } {
  assertDate(d, "tashkentTime");
  const local = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** UTC milliseconds of 00:00 Tashkent time on the local date of `d`. */
export function tashkentMidnight(d: Date): number {
  assertDate(d, "tashkentMidnight");
  return Math.floor((d.getTime() + TASHKENT_OFFSET_MS) / DAY_MS) * DAY_MS - TASHKENT_OFFSET_MS;
}

/** Day of week (0 = Sunday) of a valid ISO date. Throws RangeError for anything but a real "YYYY-MM-DD". */
export function weekdayOf(date: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) throw new RangeError(`Invalid ISO date: ${JSON.stringify(date)}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new RangeError(`Invalid ISO date: ${JSON.stringify(date)}`);
  }
  return probe.getUTCDay();
}

/**
 * Adds calendar months in Tashkent local time, keeping the time of day. When the target month is shorter the result
 * is its last day (12 months from 29.02.2028 is 28.02.2029), the usual civil-law rule for terms counted in months.
 */
export function addMonthsTashkent(from: Date, months: number): Date {
  assertDate(from, "addMonthsTashkent");
  if (!Number.isInteger(months) || months < 0)
    throw new RangeError("addMonthsTashkent: months must be a non-negative integer");
  const local = new Date(from.getTime() + TASHKENT_OFFSET_MS);
  const index = local.getUTCFullYear() * 12 + local.getUTCMonth() + months;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), lastDay);
  const shifted = Date.UTC(
    year,
    month,
    day,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(shifted - TASHKENT_OFFSET_MS);
}
