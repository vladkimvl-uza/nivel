import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_ROLES, APP_SCHEMAS } from "./index.ts";
import { runMigrations } from "./migrate.ts";

// Runs against a per-worker clone of nivel_s<slot>_template_test (packages/testing harness).
let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATOR });
  await client.connect();
});
afterAll(async () => {
  await client.end();
});

describe("first migration", () => {
  it("connects to a guarded test database", async () => {
    const { rows } = await client.query<{ db: string; port: number }>(
      "select current_database() as db, inet_server_port() as port",
    );
    expect(rows[0]?.db).toMatch(/^nivel_s\d_w\w+_test$/);
  });

  it("creates the seven application schemas", async () => {
    const { rows } = await client.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname = any($1) order by nspname",
      [APP_SCHEMAS],
    );
    expect(rows.map((r) => r.nspname)).toEqual([...APP_SCHEMAS].sort());
  });

  it("installs pg_trgm", async () => {
    const { rowCount } = await client.query("select 1 from pg_extension where extname = 'pg_trgm'");
    expect(rowCount).toBe(1);
  });

  it("has all application roles", async () => {
    const { rows } = await client.query<{ rolname: string }>("select rolname from pg_roles where rolname = any($1)", [
      APP_ROLES,
    ]);
    expect(rows).toHaveLength(APP_ROLES.length);
  });

  it("is idempotent: a second run applies nothing", async () => {
    const before = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    await runMigrations(process.env.DATABASE_URL_MIGRATOR as string);
    const after = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("supports DEFAULT uuidv7() (PostgreSQL 18)", async () => {
    await client.query("create temp table t (id uuid primary key default uuidv7(), n int)");
    const { rows } = await client.query<{ v: number }>(
      "insert into t (n) values (1), (2) returning uuid_extract_version(id) as v",
    );
    expect(rows.map((r) => r.v)).toEqual([7, 7]);
  });

  it("gives application roles no DDL in application schemas", async () => {
    const web = new pg.Client({ connectionString: process.env.DATABASE_URL_WEB });
    await web.connect();
    try {
      await expect(web.query("create table catalog.x (id int)")).rejects.toThrow(/permission denied/);
    } finally {
      await web.end();
    }
  });

  it("grants default table privileges per role", async () => {
    await client.query("create table catalog.wp00_probe (id uuid primary key default uuidv7())");
    try {
      const { rows } = await client.query<{ role: string; sel: boolean; ins: boolean }>(
        `select r as role,
                has_table_privilege(r, 'catalog.wp00_probe', 'SELECT') as sel,
                has_table_privilege(r, 'catalog.wp00_probe', 'INSERT') as ins
           from unnest(array['nivel_web','nivel_admin','nivel_bot','nivel_worker']) as r order by r`,
      );
      expect(rows).toEqual([
        { role: "nivel_admin", sel: true, ins: true },
        { role: "nivel_bot", sel: true, ins: false },
        { role: "nivel_web", sel: true, ins: false },
        { role: "nivel_worker", sel: true, ins: false },
      ]);
    } finally {
      await client.query("drop table catalog.wp00_probe");
    }
  });
});
