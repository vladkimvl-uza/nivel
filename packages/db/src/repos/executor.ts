// What a repository function runs on: the connection pool or a transaction handle (ARCHITECTURE 4.13: one
// transaction for status, journal and outbox, so every function accepts both).
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;
