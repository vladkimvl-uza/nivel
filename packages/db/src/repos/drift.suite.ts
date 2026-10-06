import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema/index.ts";
import { connectAs } from "./testkit.ts";

// The Drizzle definitions (src/schema) and the migrated database must say the same: the tables of the schema files
// are what repositories and services type against, the migrations are what runs. Generated and hand-written SQL
// (triggers, views, functions) is covered by the other suites.
const tables = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable[];

let c: pg.Client;
beforeAll(async () => {
  c = await connectAs("MIGRATOR");
});
afterAll(async () => {
  await c.end();
});

describe("schema files against the migrated database", () => {
  it("define the tables of the architecture (all but the one made in SQL)", () => {
    // 58 tables of ARCHITECTURE 3.3 (plus number_counters); sales.order_transitions, the data of the status graph, is made in SQL.
    expect(tables.length).toBe(58);
  });

  it.each(tables.map((t) => [`${getTableConfig(t).schema}.${getTableName(t)}`, t] as const))(
    "%s: the same columns, nullability and primary key",
    async (_name, t) => {
      const cfg = getTableConfig(t);
      const { rows } = await c.query<{ column_name: string; is_nullable: "YES" | "NO" }>(
        "select column_name, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2",
        [cfg.schema, cfg.name],
      );
      const db = new Map(rows.map((r) => [r.column_name, r.is_nullable === "YES"]));
      expect([...db.keys()].sort()).toEqual(cfg.columns.map((col) => col.name).sort());
      for (const col of cfg.columns) {
        const nullable = db.get(col.name);
        // A primary key column is NOT NULL even where the builder leaves it implicit.
        expect(nullable, `${cfg.name}.${col.name} nullable`).toBe(!(col.notNull || col.primary));
      }
    },
  );

  it.each(tables.map((t) => [`${getTableConfig(t).schema}.${getTableName(t)}`, t] as const))(
    "%s: its keys, checks and indexes exist in the database under the same names",
    async (_name, t) => {
      const cfg = getTableConfig(t);
      const names = async (sql: string) =>
        new Set((await c.query<{ n: string }>(sql, [cfg.schema, cfg.name])).rows.map((r) => r.n));
      const constraints = await names(
        `select conname as n from pg_constraint
          where conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass`,
      );
      const indexes = await names("select indexname as n from pg_indexes where schemaname = $1 and tablename = $2");
      for (const fk of cfg.foreignKeys) {
        // Resolving the reference runs the thunk of `references(() => other.id)`.
        const ref = fk.reference();
        expect(ref.foreignColumns.length).toBe(ref.columns.length);
        expect(constraints.has(fk.getName()), `foreign key ${fk.getName()}`).toBe(true);
      }
      for (const ck of cfg.checks) expect(constraints.has(ck.name), `check ${ck.name}`).toBe(true);
      for (const u of cfg.uniqueConstraints) {
        const name = u.name ?? u.getName() ?? "";
        expect(constraints.has(name) || indexes.has(name), `unique ${name}`).toBe(true);
      }
      for (const ix of cfg.indexes) expect(indexes.has(ix.config.name ?? ""), `index ${ix.config.name}`).toBe(true);
      if (cfg.primaryKeys.length > 0)
        expect([...constraints].some((n) => n.endsWith("_pkey") || n.includes("_pk"))).toBe(true);
    },
  );
});
