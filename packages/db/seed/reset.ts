// WP-06: `pnpm db:reset`: drops the application schemas, applies every migration from scratch and seeds the rules and
// the demo layer. Development and test databases only: production and non-local hosts are refused.
import pg from "pg";
import { runMigrations } from "../src/migrate.ts";
import { assertDemoAllowed, DemoSeedRefused, type DemoSeedResult, seedDemo } from "./demo.ts";
import { readAppMode, UnknownAppMode } from "./mode.ts";
import { type RulesSeedResult, seedRules } from "./rules.ts";

const APP_SCHEMAS = ["catalog", "pricing", "sales", "content", "ai", "bot", "ops"] as const;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
// The two clusters of this project (CLAUDE.md): development on 54329 with the database `nivel`, tests on 54339 with
// throwaway databases `*_test`. Other projects of this machine and tunnels to a real database look local as well.
const DEV_PORT = "54329";
const TEST_PORT = "54339";

export class ResetRefused extends Error {
  constructor(reason: string) {
    super(`reset refused: ${reason}`);
    this.name = "ResetRefused";
  }
}

/**
 * Throws unless the mode is a known one and not production, and the target is a database of this project: local host,
 * the development cluster with the database `nivel` or the test cluster with a database whose name ends in `_test`.
 */
export function assertResetAllowed(url: string, env: Record<string, string | undefined> = process.env): void {
  try {
    if (readAppMode(env) === "production") throw new ResetRefused("APP_MODE=production");
  } catch (e) {
    if (e instanceof UnknownAppMode) throw new ResetRefused(e.message);
    throw e;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ResetRefused("the connection string is not a URL");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) throw new ResetRefused(`host ${parsed.hostname} is not local`);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.port === DEV_PORT) {
    if (database !== "nivel")
      throw new ResetRefused(`database "${database}" on the development cluster must be "nivel"`);
  } else if (parsed.port === TEST_PORT) {
    if (!database.endsWith("_test"))
      throw new ResetRefused(`database "${database}" on the test cluster must end with "_test"`);
  } else {
    throw new ResetRefused(
      `port ${parsed.port || "(default)"} is not a cluster of this project (${DEV_PORT}, ${TEST_PORT})`,
    );
  }
}

export interface SeedAllResult {
  rules: RulesSeedResult;
  demo: DemoSeedResult | null;
}

/** Rules always; the demo layer unless the environment forbids it (then `demo` is null and the rules stay). */
export async function seedAll(
  url: string,
  env: Record<string, string | undefined> = process.env,
): Promise<SeedAllResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const rules = await seedRules(client, env);
    let demo: DemoSeedResult | null = null;
    try {
      assertDemoAllowed(env);
      demo = await seedDemo(client, env);
    } catch (e) {
      if (!(e instanceof DemoSeedRefused)) throw e;
    }
    await client.query("commit");
    return { rules, demo };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

/** Drops the seven application schemas and the migration journal, migrates from zero, seeds. */
export async function resetDatabase(
  url: string,
  env: Record<string, string | undefined> = process.env,
): Promise<SeedAllResult> {
  assertResetAllowed(url, env);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    for (const schema of APP_SCHEMAS) await client.query(`drop schema if exists ${schema} cascade`);
    await client.query("drop schema if exists drizzle cascade");
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  await runMigrations(url);
  return seedAll(url, env);
}
