import type { IsoDate } from "../money/types.ts";
import { DAY_MS, isoDateInTashkent, tashkentMidnight, tashkentTime, weekdayOf } from "./tashkent.ts";
import type { CalendarApi, ResponseHours, WorkCalendar } from "./types.ts";

export { addMonthsTashkent, isoDateInTashkent, tashkentTime } from "./tashkent.ts";
export type * from "./types.ts";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(value: string, label: string): number {
  const m = HHMM.exec(value);
  if (m === null) throw new RangeError(`createWorkCalendar: ${label} must be "HH:MM", got ${JSON.stringify(value)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Working week Monday to Saturday in Asia/Tashkent minus the given holidays.
 * - `addWorkingDays` counts working days after the local date of `from` and keeps the time of day.
 * - `nextWorkingDayStart` is the opening time (`hours.from`) of the first working day strictly after the local date
 *   of `from`: money received on Monday at any hour allows purchases from Tuesday 10:00.
 */
export function createWorkCalendar(holidays: readonly IsoDate[], hours: ResponseHours): WorkCalendar {
  const from = minutesOf(hours.from, "hours.from");
  const to = minutesOf(hours.to, "hours.to");
  if (to <= from) throw new RangeError("createWorkCalendar: hours.to must be later than hours.from");
  const holidaySet = new Set<IsoDate>();
  for (const h of holidays) {
    weekdayOf(h); // validates
    holidaySet.add(h);
  }

  const isWorkingDay = (d: IsoDate): boolean => weekdayOf(d) !== 0 && !holidaySet.has(d);
  const isWorkingInstant = (ms: number): boolean => isWorkingDay(isoDateInTashkent(new Date(ms)));

  return {
    isWorkingDay,
    addWorkingDays(start: Date, n: number): Date {
      if (!Number.isInteger(n) || n < 0) throw new RangeError("addWorkingDays: n must be a non-negative integer");
      isoDateInTashkent(start); // validates the Date
      let cursor = start.getTime();
      for (let counted = 0; counted < n; ) {
        cursor += DAY_MS;
        if (isWorkingInstant(cursor)) counted += 1;
      }
      return new Date(cursor);
    },
    nextWorkingDayStart(start: Date): Date {
      let day = tashkentMidnight(start) + DAY_MS;
      while (!isWorkingInstant(day)) day += DAY_MS;
      return new Date(day + from * 60_000);
    },
    isResponseHours(at: Date): boolean {
      const { hour, minute } = tashkentTime(at);
      const minutes = hour * 60 + minute;
      return isWorkingDay(isoDateInTashkent(at)) && minutes >= from && minutes < to;
    },
  };
}

export const calendarApi = { createWorkCalendar } satisfies CalendarApi;
