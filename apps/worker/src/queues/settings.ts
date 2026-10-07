// The settings of the owner (ops.settings) that the worker reads. The worker has SELECT on the table and nothing else (DATA-MAP 2).
// The calendar is read here as the services read it (orders/settings.ts, not exported): holidays, the first and the last hour of
// the answers; the days Monday to Saturday are the domain's.
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { createWorkCalendar, type WorkCalendar } from "@nivel/domain/calendar";

export const CALENDAR_KEY = "calendar.work";
/** The chat id of the group of the owner: a number, or `{ "chatId": number }`. Written by the owner or the bot (WP-13). */
export const OWNER_GROUP_KEY = "telegram.owner_group";

/** The chat id of the owner's group, or `null` when the setting is missing or is not a chat id. */
export function parseOwnerGroup(value: unknown): number | null {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { chatId?: unknown }).chatId
      : value;
  const n = typeof raw === "string" && /^-?\d+$/.test(raw) ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n !== 0 ? n : null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The business calendar from the setting; without one, Monday to Saturday 10:00-19:00 with no holidays. */
export function parseCalendar(value: unknown): WorkCalendar {
  const raw = value ?? { holidays: [], from: "10:00", to: "19:00" };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`setting ${CALENDAR_KEY} must be an object`);
  const { holidays, from, to } = raw as { holidays?: unknown; from?: unknown; to?: unknown };
  if (typeof from !== "string" || !HHMM.test(from) || typeof to !== "string" || !HHMM.test(to)) {
    throw new Error(`setting ${CALENDAR_KEY}: from and to must be times like 10:00`);
  }
  if (!Array.isArray(holidays) || holidays.some((h) => typeof h !== "string" || !DATE.test(h))) {
    throw new Error(`setting ${CALENDAR_KEY}: holidays must be a list of dates like 2026-10-13`);
  }
  try {
    return createWorkCalendar(holidays as string[], { from, to });
  } catch (e) {
    throw new Error(`setting ${CALENDAR_KEY}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function loadCalendar(db: Db): Promise<WorkCalendar> {
  return parseCalendar((await ops.getSetting(db, CALENDAR_KEY))?.value);
}

export async function loadOwnerGroup(db: Db): Promise<number | null> {
  return parseOwnerGroup((await ops.getSetting(db, OWNER_GROUP_KEY))?.value);
}

/** A feature flag is on only when its setting is exactly `true`. */
export async function isFlagOn(db: Db, key: string): Promise<boolean> {
  return (await ops.getSetting(db, key))?.value === true;
}
