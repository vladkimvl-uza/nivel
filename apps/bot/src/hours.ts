// The hours of the answers (Monday to Saturday, 10:00-19:00 in Tashkent, holidays of the owner): the automatic answer
// outside them names the next opening (ARCHITECTURE 7.2 «Автоответ»).
import type { WorkCalendar } from "@nivel/domain/calendar";

const MINUTE_MS = 60_000;
/** Three weeks: longer than any run of holidays; after that the scan gives up and answers with the last instant it tried. */
const HORIZON_MINUTES = 21 * 24 * 60;

/** The first minute at or after `from` that is an hour of the answers. */
export function nextOpening(cal: WorkCalendar, from: Date): Date {
  if (cal.isResponseHours(from)) return from;
  // The openings are on whole minutes: start from the next whole minute so that "10:00" is hit exactly.
  let t = Math.ceil(from.getTime() / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i < HORIZON_MINUTES; i++, t += MINUTE_MS) {
    if (cal.isResponseHours(new Date(t))) return new Date(t);
  }
  return new Date(t);
}
