// Drizzle operators (`sql`, `eq`, `and`, ...) without importing drizzle-orm: this package declares no dependency of its
// own on it (new dependencies are the integrator's), but the relational query API hands the same operators to the
// `where` callback. `toSQL()` builds the query without running it, so nothing is sent to the database. Every value that
// reaches a query through these operators is a bound parameter (ARCHITECTURE 10.1, A05).
import type { Db } from "@nivel/db";

type FindFirstConfig = NonNullable<Parameters<Db["query"]["orders"]["findFirst"]>[0]>;
type WhereOption = NonNullable<FindFirstConfig["where"]>;
export type Dsl = Parameters<Extract<WhereOption, (...args: never[]) => unknown>>[1];

let captured: Dsl | undefined;

/** The operators of drizzle; stateless, so one capture serves every handle. */
export function dsl(db: Pick<Db, "query">): Dsl {
  if (captured) return captured;
  db.query.orders
    .findFirst({
      where: (_table, operators) => {
        captured = operators;
        return undefined;
      },
    })
    .toSQL();
  if (!captured) throw new Error("drizzle did not hand over its operators");
  return captured;
}
