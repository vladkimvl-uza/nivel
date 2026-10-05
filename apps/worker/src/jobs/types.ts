import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

/** What a job domain receives at startup: the queue client and a child logger. */
export interface JobContext {
  boss: PgBoss;
  log: Logger;
}
