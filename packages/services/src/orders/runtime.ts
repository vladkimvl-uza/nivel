// What every scenario runs on: the database handle of this process, the role it connects with, the clock and the mode
// (ARCHITECTURE 4.13). Each app connects with its own role (DATABASE_URL_<APP>), and the database grants differ by
// role (DATA-MAP 2): the role decides which writes a scenario may do itself and which it leaves to the outbox.
import type { Db } from "@nivel/db";
import { ConfigError, ForbiddenError } from "./errors.ts";

export type DbRole = "web" | "admin" | "bot" | "worker";
export type AppMode = "development" | "staging" | "production";

export interface Runtime {
  readonly db: Db;
  readonly role: DbRole;
  readonly appMode: AppMode;
  /** The clock of the process; tests inject a fake one. The database stamps journal rows with its own clock. */
  now(): Date;
}

export interface RuntimeOptions {
  db: Db;
  role: DbRole;
  appMode?: AppMode;
  now?: () => Date;
}

const APP_MODES: readonly string[] = ["development", "staging", "production"];

/** Same reading as packages/config: empty means development, anything outside the three names is refused. */
export function readAppMode(raw: string | undefined): AppMode {
  const value = (raw ?? "").trim();
  if (value === "") return "development";
  if (!APP_MODES.includes(value))
    throw new ConfigError(`APP_MODE must be one of ${APP_MODES.join(", ")}, got "${value}"`);
  return value as AppMode;
}

export function createRuntime(o: RuntimeOptions): Runtime {
  const appMode = o.appMode ?? readAppMode(process.env.APP_MODE);
  const clock = o.now ?? (() => new Date());
  return {
    db: o.db,
    role: o.role,
    appMode,
    now() {
      const at = clock();
      if (!(at instanceof Date) || Number.isNaN(at.getTime()))
        throw new ConfigError("the clock returned an invalid date");
      return at;
    },
  };
}

let current: Runtime | undefined;

/** Called once at the start of an app: every scenario without an explicit runtime uses this one. */
export function configureServices(o: RuntimeOptions): Runtime {
  current = createRuntime(o);
  return current;
}

export function resetServices(): void {
  current = undefined;
}

/** The runtime of the process, or `rt` when a caller (a test, a job with its own handle) brings one. */
export function runtimeOf(rt?: Runtime): Runtime {
  const found = rt ?? current;
  if (!found) throw new ConfigError("services are not configured: call configureServices({ db, role }) at startup");
  return found;
}

/** What a role may write itself. Everything else goes through the outbox or is refused (DATA-MAP 2, 00_grants.sql). */
const CAPABILITIES = {
  /** Read orders, quotes, payments, purchases, events: the site reads the customer views only. */
  "orders.read": ["admin", "bot", "worker"],
  "orders.create": ["admin"],
  "quotes.write": ["admin"],
  "payments.write": ["admin"],
  "purchases.write": ["admin"],
  "acts.write": ["admin"],
  "reports.write": ["admin"],
  "ledger.write": ["admin", "worker"],
  /** The reserve ledger is read by the owner's panel and the worker; the bot and the site do not see it. */
  "ledger.read": ["admin", "worker"],
  /** Money consents (limit overrun, no receipt, replacement, third-party payer) are not recorded by the site. */
  "consents.money": ["admin", "bot"],
} as const satisfies Record<string, readonly DbRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(rt: Runtime, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly DbRole[]).includes(rt.role);
}

export function requireCapability(rt: Runtime, capability: Capability): void {
  if (!can(rt, capability)) {
    throw new ForbiddenError(`the ${rt.role} role of the database cannot do ${capability}`);
  }
}
