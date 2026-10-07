// Test database harness: one template database per slot (rebuilt when migrations change) and one database per
// vitest worker cloned from it. All DATABASE_URL_* are overridden at once (ARCHITECTURE 11.3).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR, runMigrations } from "@nivel/db";
import pg from "pg";
import { assertTestClusterUrl, assertTestDatabaseUrl, testDatabaseNames, withDatabase } from "./db-guard.ts";

export const APP_DB_KEYS = ["MIGRATOR", "WEB", "ADMIN", "BOT", "WORKER"] as const;
export type AppDbKey = (typeof APP_DB_KEYS)[number];
type EnvLike = Record<string, string | undefined>;

function required(env: EnvLike, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is not set (run pnpm env:init and pnpm infra:test:up)`);
  return v;
}

function slotOf(env: EnvLike): number {
  const n = Number.parseInt(env.NIVEL_SLOT || "0", 10);
  if (!Number.isInteger(n) || n < 0 || n > 9) throw new Error(`NIVEL_SLOT must be 0..9, got ${env.NIVEL_SLOT}`);
  return n;
}

/** Hash of the migrations folder: a changed migration rebuilds the template. */
export function migrationsHash(dir: string = MIGRATIONS_DIR): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(name).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex").slice(0, 16);
}

async function withSuper<T>(env: EnvLike, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const url = required(env, "TEST_DATABASE_URL_SUPER");
  assertTestClusterUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const ident = (name: string) => {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe identifier ${name}`);
  return `"${name}"`;
};

/** The roles of the applications: they connect to the database and hold no other right on it. */
export const APP_ROLES_WITH_CONNECT = ["nivel_web", "nivel_admin", "nivel_bot", "nivel_worker"] as const;

/**
 * The rights on the database itself, as `nivel` has them after infra/postgres/init/01-roles.sh and the migrations: PUBLIC
 * holds nothing, the four application roles may connect and hold nothing else (no CREATE, no TEMP), the owner
 * (nivel_migrator) holds the rest. CREATE DATABASE ... TEMPLATE copies the data and not these rights, so the REVOKEs of
 * the migrations stay in the template: a clone would keep the defaults of PostgreSQL (CONNECT and TEMP for PUBLIC) and,
 * as it used to, whatever the harness granted by hand, and a test would never see what production refuses (a role that
 * makes a schema or a temporary table).
 */
export function productionRightsSql(database: string): string[] {
  const db = ident(database);
  return [
    `revoke all on database ${db} from public`,
    `grant connect on database ${db} to ${APP_ROLES_WITH_CONNECT.join(", ")}`,
  ];
}

/** Creates or refreshes nivel_s<slot>_template_test with all migrations applied as nivel_migrator. */
export async function prepareTemplate(env: EnvLike = process.env): Promise<{ name: string; rebuilt: boolean }> {
  const slot = slotOf(env);
  const { template } = testDatabaseNames(slot, 0);
  const migratorUrl = withDatabase(required(env, "TEST_DATABASE_URL_MIGRATOR"), template);
  const hash = migrationsHash();
  const marker = `migrations:${hash}`;

  const rebuilt = await withSuper(env, async (c) => {
    const found = await c.query<{ comment: string | null }>(
      "select shobj_description(oid, 'pg_database') as comment from pg_database where datname = $1",
      [template],
    );
    if (found.rows[0]?.comment === marker) return false;
    await c.query(`drop database if exists ${ident(template)} with (force)`);
    await c.query(`create database ${ident(template)} owner nivel_migrator`);
    return true;
  });

  if (rebuilt) {
    await runMigrations(migratorUrl);
    await withSuper(env, (c) => c.query(`comment on database ${ident(template)} is '${marker}'`));
  }
  return { name: template, rebuilt };
}

export interface WorkerDatabase {
  name: string;
  urls: Record<AppDbKey, string>;
  drop(): Promise<void>;
}

/** Clones the template for one vitest worker and points every DATABASE_URL_* of `target` at it. */
export async function createWorkerDatabase(
  worker: number | string,
  env: EnvLike = process.env,
  target: EnvLike = process.env,
): Promise<WorkerDatabase> {
  const slot = slotOf(env);
  const names = testDatabaseNames(slot, worker);
  const urls = Object.fromEntries(
    APP_DB_KEYS.map((k) => [k, withDatabase(required(env, `TEST_DATABASE_URL_${k}`), names.worker)]),
  ) as Record<AppDbKey, string>;
  for (const url of Object.values(urls)) assertTestDatabaseUrl(url);

  await withSuper(env, async (c) => {
    await c.query(`drop database if exists ${ident(names.worker)} with (force)`);
    await c.query(`create database ${ident(names.worker)} template ${ident(names.template)} owner nivel_migrator`);
    // Database-level rights are not copied from the template: give the clone those of the production database.
    for (const statement of productionRightsSql(names.worker)) await c.query(statement);
  });

  for (const k of APP_DB_KEYS) target[`DATABASE_URL_${k}`] = urls[k];

  return {
    name: names.worker,
    urls,
    drop: () =>
      withSuper(env, (c) => c.query(`drop database if exists ${ident(names.worker)} with (force)`)).then(() => {}),
  };
}
