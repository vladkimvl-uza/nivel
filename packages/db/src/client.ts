import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/** One pool per process; each app connects with its own role (DATABASE_URL_<APP>). */
export function createDb(connectionString: string, options: { max?: number; applicationName?: string } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 5,
    ...(options.applicationName ? { application_name: options.applicationName } : {}),
  });
  return drizzle({ client: pool, schema }) as Db;
}
