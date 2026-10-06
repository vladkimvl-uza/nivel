// WP-06: `pnpm db:reset`: drops the application schemas, applies every migration from scratch and seeds the rules and
// the demo layer. Development and test databases only: production and non-local hosts are refused.
import pg from "pg";
import { runMigrations } from "../src/migrate.ts";
import { assertDemoAllowed, type DemoSeedResult, seedDemo } from "./demo.ts";
import { type RulesSeedResult, seedRules } from "./rules.ts";

const APP_SCHEMAS = ["catalog", "pricing", "sales", "content", "ai", "bot", "ops"] as const;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class ResetRefused extends Error {
  constructor(reason: string) {
    super(`reset refused: ${reason}`);
    this.name = "ResetRefused";
  }
}

/** Throws unless the target is a local database and the mode is not production. */
export function assertResetAllowed(url: string, env: Record<string, string | undefined> = process.env): void {
  if (env.APP_MODE === "production") throw new ResetRefused("APP_MODE=production");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ResetRefused("the connection string is not a URL");
  }
  if (!LOCAL_HOSTS.has(host)) throw new ResetRefused(`host ${host} is not local`);
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
    const rules = await seedRules(client);
    let demo: DemoSeedResult | null = null;
    try {
      assertDemoAllowed(env);
      demo = await seedDemo(client, env);
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "DemoSeedRefused") throw e;
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
