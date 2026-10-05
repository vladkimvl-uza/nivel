import { NotImplementedError } from "../errors.ts";
import type { IsoDate } from "../money/types.ts";
import type { CalendarApi, ResponseHours, WorkCalendar } from "./types.ts";

export type * from "./types.ts";

export function createWorkCalendar(_holidays: readonly IsoDate[], _hours: ResponseHours): WorkCalendar {
  throw new NotImplementedError("calendar.createWorkCalendar");
}

export const calendarApi = { createWorkCalendar } satisfies CalendarApi;
