// The journal screen (ARCHITECTURE 6.3): who changed what, when. Reading only; the journal is append-only in the
// database, the admin has no way to change a row.

export interface JournalQuery {
  entity?: string;
  actor?: string;
  /** Prefix of the action, e.g. `auth.` or `setting`. */
  action?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

const MAX_TEXT = 120;
const PAGE_SIZE = 50;

function one(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, MAX_TEXT);
  return text === "" ? undefined : text;
}

/** Midnight of a Tashkent calendar day (UTC+5) as a UTC instant. */
function tashkentDay(text: string | undefined): Date | undefined {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00+05:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) === "NaN") return undefined;
  // `2026-02-30` rolls over to March: refuse it.
  const back = new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
  return back === text ? date : undefined;
}

export function parseJournalQuery(raw: Record<string, string | string[] | undefined>): JournalQuery {
  const entity = one(raw.entity);
  const actor = one(raw.actor);
  const action = one(raw.action);
  const from = tashkentDay(one(raw.from));
  const toDay = tashkentDay(one(raw.to));
  // "to" is the last day shown: the bound is the start of the next one.
  const to = toDay ? new Date(toDay.getTime() + 24 * 3_600_000) : undefined;
  const page = Number(typeof raw.page === "string" ? raw.page : "1");
  return {
    ...(entity ? { entity } : {}),
    ...(actor ? { actor } : {}),
    ...(action ? { action } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZE,
  };
}

const MAX_PATHS = 12;

function leaves(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, "{}");
    for (const [k, v] of entries) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || "(значение)", JSON.stringify(value));
  }
}

/** The dotted paths that differ between two JSON values; arrays count as one value. */
export function changedPaths(before: unknown, after: unknown): string[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  if (before !== null && before !== undefined) leaves(before, "", a);
  if (after !== null && after !== undefined) leaves(after, "", b);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const changed: string[] = [];
  for (const k of keys) if (a.get(k) !== b.get(k)) changed.push(k);
  return changed.slice(0, MAX_PATHS);
}

const SECRET_KEY = /pass(word)?|secret|token|hash|totp|apikey|api_key|authorization|cookie/i;

/** Defence in depth: nothing that looks like a secret is shown, even if some action wrote one by mistake. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "***" : redact(v)]),
    );
  }
  return value;
}

const TITLES: Record<string, string> = {
  "auth.login": "Вход",
  "auth.login_failed": "Неудачный вход",
  "auth.locked": "Блокировка входа",
  "auth.logout": "Выход",
  "auth.recovery_used": "Вход по коду восстановления",
  "auth.recovery_regenerated": "Новые коды восстановления",
  "auth.password_changed": "Смена пароля",
  "auth.telegram_bound": "Привязка Telegram",
  "auth.user_created": "Создана учётная запись",
  "auth.user_enabled": "Учётная запись включена",
  "auth.user_disabled": "Учётная запись выключена",
  "setting.set": "Изменение настройки",
  "catalog.create": "Новая позиция",
  "catalog.update": "Изменение позиции",
  "catalog.import": "Импорт каталога",
  "files.upload": "Загрузка файла",
};

export function actionTitle(action: string): string {
  if (action.endsWith(".denied")) return `Отказано: ${TITLES[action.slice(0, -7)] ?? action.slice(0, -7)}`;
  return TITLES[action] ?? action;
}

export interface JournalRow {
  id: string;
  at: Date;
  actor: string;
  action: string;
  title: string;
  entity: string;
  entityId: string | null;
  changed: string[];
  before: unknown;
  after: unknown;
}
