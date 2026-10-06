// A lock for the length of the transaction, by a name: two requests about the same order or lead wait for each other.
// `FOR UPDATE` would need the right to UPDATE the table, which the bot and the worker do not have; an advisory lock
// needs nothing and is released at COMMIT or ROLLBACK.
import type { Executor } from "@nivel/db/repos";
import { dsl } from "./dsl.ts";

export async function lockBy(ex: Executor, key: string): Promise<void> {
  const { sql } = dsl(ex);
  await ex.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
