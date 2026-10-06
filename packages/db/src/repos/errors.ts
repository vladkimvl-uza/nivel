// Rules the database enforces as the second line of defence raise errors with a machine key before the colon
// ("limit_exceeded: ...") or a named CHECK constraint. Repositories turn them into DbRuleError so that services
// map them to GuardError values without parsing messages (ARCHITECTURE 3.4, 4.13).

export type DbRuleCode =
  | "append_only"
  | "immutable"
  | "direct_status_change"
  | "invalid_initial_status"
  | "limit_exceeded"
  | "funds_exceeded"
  | "not_reconciled"
  | "consent_missing"
  | "no_current_quote"
  | "actor_not_allowed"
  | "change_not_allowed"
  | "payments_incomplete"
  | "invalid_transition"
  | "stale_status"
  | "order_not_found"
  | "unknown_change"
  | "invalid_event"
  | "invalid_actor"
  | "text_hash_mismatch"
  | "check_violation"
  | "unique_violation"
  | "foreign_key_violation"
  | "permission_denied";

const KEYED: ReadonlySet<string> = new Set<DbRuleCode>([
  "append_only",
  "immutable",
  "direct_status_change",
  "invalid_initial_status",
  "limit_exceeded",
  "funds_exceeded",
  "not_reconciled",
  "consent_missing",
  "no_current_quote",
  "actor_not_allowed",
  "change_not_allowed",
  "payments_incomplete",
  "invalid_transition",
  "stale_status",
  "order_not_found",
  "unknown_change",
  "invalid_event",
  "invalid_actor",
  "text_hash_mismatch",
]);

export class DbRuleError extends Error {
  readonly code: DbRuleCode;
  /** Name of the violated CHECK, unique index or foreign key, when PostgreSQL names one. */
  readonly constraint: string | undefined;
  constructor(code: DbRuleCode, message: string, constraint?: string) {
    super(message);
    this.name = "DbRuleError";
    this.code = code;
    this.constraint = constraint;
  }
}

interface PgLike {
  code?: string;
  message?: string;
  constraint?: string;
  cause?: unknown;
}

/** Drizzle wraps driver errors (`cause`); the PostgreSQL error is the innermost one with a SQLSTATE. */
function pgErrorOf(e: unknown): PgLike | null {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = cur as PgLike;
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

/** DbRuleError for a rule violation of the database, or null for anything else (network, bugs). */
export function toRuleError(e: unknown): DbRuleError | null {
  if (e instanceof DbRuleError) return e;
  const pg = pgErrorOf(e);
  if (!pg?.message) return null;
  const key = /^(\w+):/.exec(pg.message)?.[1];
  if (key && KEYED.has(key)) return new DbRuleError(key as DbRuleCode, pg.message, pg.constraint);
  switch (pg.code) {
    case "23514":
      return new DbRuleError("check_violation", pg.message, pg.constraint);
    case "23505":
      return new DbRuleError("unique_violation", pg.message, pg.constraint);
    case "23503":
      return new DbRuleError("foreign_key_violation", pg.message, pg.constraint);
    case "42501":
      return new DbRuleError("permission_denied", pg.message, pg.constraint);
    case "40001":
      return new DbRuleError("stale_status", pg.message, pg.constraint);
    default:
      return null;
  }
}

/** Runs `fn` and rethrows a database rule violation as DbRuleError; other errors pass through untouched. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toRuleError(e) ?? e;
  }
}
