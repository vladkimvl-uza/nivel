// What the bot needs from its process: the database as the role `nivel_bot`, the services runtime of the same role,
// the clock and a few settings of the environment. Tests bring their own (a throwaway database, a fake clock).
import type { Db } from "@nivel/db";
import type { orders } from "@nivel/services";
import type { Logger } from "pino";

export interface BotDeps {
  db: Db;
  /** The runtime of `@nivel/services` for the bot role: every scenario is called with it. */
  rt: orders.Runtime;
  now: () => Date;
  appMode: orders.AppMode;
  /** TELEGRAM_OWNER_IDS: the Telegram ids of the owner. The database checks them against ops.admin_users again. */
  ownerIds: readonly string[];
  /** PUBLIC_BASE_URL, for the links to the policy. */
  publicBaseUrl: string;
  log: Pick<Logger, "info" | "warn" | "error">;
}
