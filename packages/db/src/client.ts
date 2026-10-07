import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/** One pool per process; each app connects with its own role (DATABASE_URL_<APP>). */
export function createDb(
  connectionString: string,
  options: { max?: number; applicationName?: string; onError?: (error: Error) => void } = {},
): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 5,
    ...(options.applicationName ? { application_name: options.applicationName } : {}),
  });
  // An idle client that loses its connection (database restart, network) emits "error" on the pool; without a
  // listener Node ends the process. pg drops the broken client, and the next query takes a fresh one.
  pool.on("error", (error) => options.onError?.(error));
  return drizzle({ client: pool, schema }) as Db;
}
