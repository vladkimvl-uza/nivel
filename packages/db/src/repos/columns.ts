// Column builders shared by the schema files (ARCHITECTURE 3.1). Lives under repos/ because the module schema files
// and the repositories are the only paths of WP-06 inside src/.
import type { Localized } from "@nivel/domain/money";
import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

/** `uuid DEFAULT uuidv7()` primary key (PostgreSQL 18). */
export const pk = (name = "id") => uuid(name).primaryKey().default(sql`uuidv7()`);

/** `timestamptz`; the database stores UTC, the business calendar is Asia/Tashkent. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** `timestamptz NOT NULL DEFAULT now()`. */
export const createdAt = (name = "created_at") => tstz(name).notNull().defaultNow();
/** The change time of a row: set by the touch trigger of the table on every UPDATE. */
export const updatedAt = () => createdAt("updated_at");

/** Whole sums: `bigint`, read as a JS number (safe up to 9·10^15, ARCHITECTURE 3.1). */
export const sumCol = (name: string) => bigint(name, { mode: "number" });

/** `{ "uz": "...", "ru": "..." }`. */
export const localized = (name: string) => jsonb(name).$type<Localized>();

/** SQL fragment `col IN ('a', 'b')` for CHECK constraints (enums are text + CHECK, so a value list can change in a migration). */
export function oneOf(column: AnyPgColumn, values: readonly string[]) {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}
