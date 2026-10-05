// Calendar contract: WorkCalendar is frozen in order/types.ts (ARCHITECTURE 4.9); factory per BUILD_PLAN WP-02.
import type { IsoDate } from "../money/types.ts";
import type { WorkCalendar } from "../order/types.ts";

export type { WorkCalendar } from "../order/types.ts";

/** Response hours in Asia/Tashkent, "HH:MM" (default 10:00–19:00). */
export interface ResponseHours {
  from: string;
  to: string;
}

export interface CalendarApi {
  /** Mon–Sat working week, UZ public holidays from ops.settings, Asia/Tashkent (UTC+5). */
  createWorkCalendar(holidays: readonly IsoDate[], hours: ResponseHours): WorkCalendar;
}
