// What the owner sets in the admin panel and the bot reads (ops.settings, ARCHITECTURE 3.3). The bot only reads them.
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { createWorkCalendar, type WorkCalendar } from "@nivel/domain/calendar";

/** The id of the closed group with topics (ARCHITECTURE 7.1: "the id is in the settings"). A number or `{ chatId }`. */
export const OWNER_GROUP_KEY = "telegram.owner_group_id";
/** The Telegram ids of the assistants (a list of digit strings); the database checks each against ops.admin_users. */
export const ASSISTANT_IDS_KEY = "telegram.assistant_ids";
/** The calendar of the business, the same key the order automaton reads (holidays, hours of the answers). */
export const CALENDAR_KEY = "calendar.work";
/** The account of the sole proprietor for the money of purchases: { bank, account, mfo, inn, holder, purpose }. */
export const REQUISITES_KEY = "requisites.ip";

export async function ownerGroupId(db: Db): Promise<number | null> {
  const row = await ops.getSetting(db, OWNER_GROUP_KEY);
  const v = row?.value;
  // The id of a supergroup is a negative number; anything else (0, a text, no value) means "no group yet".
  const id = v !== null && typeof v === "object" ? (v as { chatId?: unknown }).chatId : v;
  return typeof id === "number" && Number.isSafeInteger(id) && id < 0 ? id : null;
}

export async function assistantIds(db: Db): Promise<string[]> {
  const row = await ops.getSetting(db, ASSISTANT_IDS_KEY);
  return Array.isArray(row?.value)
    ? row.value.filter((v): v is string => typeof v === "string" && /^\d+$/.test(v))
    : [];
}

/** The holidays and the hours of the answers; without the owner's settings: Monday to Saturday, 10:00-19:00. */
export async function workCalendar(db: Db): Promise<WorkCalendar> {
  const row = await ops.getSetting(db, CALENDAR_KEY);
  const raw = (row?.value ?? {}) as { holidays?: unknown; from?: unknown; to?: unknown };
  const holidays = Array.isArray(raw.holidays)
    ? raw.holidays.filter((h): h is string => typeof h === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h))
    : [];
  const from = typeof raw.from === "string" ? raw.from : "10:00";
  const to = typeof raw.to === "string" ? raw.to : "19:00";
  try {
    return createWorkCalendar(holidays, { from, to });
  } catch {
    return createWorkCalendar([], { from: "10:00", to: "19:00" });
  }
}

export interface Requisites {
  text: string;
  purpose?: string;
}

/** The requisites to show with the money of purchases; null until the owner has entered them. */
export async function paymentRequisites(db: Db): Promise<Requisites | null> {
  const row = await ops.getSetting(db, REQUISITES_KEY);
  const v = row?.value as Record<string, unknown> | null | undefined;
  if (v === null || v === undefined || typeof v !== "object") return null;
  const parts = ["holder", "bank", "account", "mfo", "inn"]
    .map((k) => v[k])
    .filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (parts.length === 0) return null;
  return {
    text: parts.join(", "),
    ...(typeof v.purpose === "string" && v.purpose.trim() !== "" ? { purpose: v.purpose } : {}),
  };
}

/** `owner` for an id of TELEGRAM_OWNER_IDS, `assistant` for one of the assistants; the database decides in the end. */
export async function staffRole(
  deps: { db: Db; ownerIds: readonly string[] },
  telegramId: number,
): Promise<"owner" | "assistant" | null> {
  const id = String(telegramId);
  if (deps.ownerIds.includes(id)) return "owner";
  return (await assistantIds(deps.db)).includes(id) ? "assistant" : null;
}
