// The queue of the worker: pg-boss on the schema `pgboss` of the application database (ARCHITECTURE 9).
import type { ConstructorOptions } from "pg-boss";

/** The schema of pg-boss: made by the migration `wp00_db_rights` (DATA-MAP 2), not by the worker. */
export const QUEUE_SCHEMA = "pgboss";

/**
 * How the worker starts pg-boss. The worker has no CREATE on the database: whoever held its password could make a schema of
 * its own, even one named like another role ("$user" is the first stop of every search_path). So pg-boss must not try to
 * create the schema: its default, CREATE SCHEMA IF NOT EXISTS, asks for the right on the database before it looks whether the
 * schema is there, and fails even when it is. The migration makes the schema and lets the worker create in it; pg-boss
 * installs and migrates its own tables there. A database that was not migrated has no schema, and the start fails at once.
 */
export function queueOptions(connectionString: string): ConstructorOptions {
  return { connectionString, schema: QUEUE_SCHEMA, application_name: "nivel-worker", createSchema: false };
}
