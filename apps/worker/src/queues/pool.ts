// The pool of the database as the worker holds it. `pg.Pool` emits 'error' when an idle client loses its connection (the database
// restarts, the network drops); an EventEmitter without a listener turns that into an uncaught exception, and the process would
// die together with the loop of the relay. The guard logs it: the next query takes a new connection.
import type { Db } from "@nivel/db";
import type { Logger } from "pino";
import { sanitizeMessage } from "./failures.ts";

export function guardPool(db: Db, log: Logger): void {
  db.$client.on("error", (err) => log.error({ err: sanitizeMessage(err) }, "pg pool: an idle client failed"));
}
