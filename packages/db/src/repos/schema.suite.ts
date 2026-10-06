import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs } from "./testkit.ts";

// ARCHITECTURE 3.3: every table of the data model exists in its schema (WP-06 acceptance: migrations from scratch).
const TABLES: Record<string, string[]> = {
  catalog: [
    "categories",
    "products",
    "price_classes",
    "ladders",
    "analogs",
    "perf_facts",
    "rule_sets",
    "base_builds",
    "base_build_items",
  ],
  pricing: ["vendors", "offers", "sku_mappings", "price_imports", "price_observations", "market_prices", "fx_rates"],
  sales: [
    "customers",
    "customer_secrets",
    "configurations",
    "leads",
    "orders",
    "order_events",
    "quotes",
    "quote_lines",
    "payments",
    "purchases",
    "purchase_files",
    "commission_reports",
    "acts",
    "build_passports",
    "warranty_cases",
    "loaner_items",
    "reserve_ledger",
    "other_income",
    "order_transitions",
  ],
  content: ["pages", "policy_texts", "legal_documents", "idea_posts", "portfolio_items", "glossary", "hero_scene"],
  ai: ["conversations", "messages", "usage_daily"],
  bot: ["sessions", "processed_updates", "subscriptions"],
  ops: [
    "outbox",
    "admin_users",
    "admin_sessions",
    "consents",
    "dsr_requests",
    "files",
    "settings",
    "audit_log",
    "app_errors",
    "threshold_snapshots",
    "number_counters",
  ],
};

const VIEWS = [
  "pricing.v_market_price_current",
  "sales.v_customer_order_status",
  "sales.v_customer_order_quotes",
  "sales.v_customer_order_payments",
  "sales.v_customer_order_purchases",
  "sales.v_deal_volume_by_year",
];

const SCHEMAS = Object.keys(TABLES);

let c: pg.Client;
beforeAll(async () => {
  c = await connectAs("MIGRATOR");
});
afterAll(async () => {
  await c.end();
});

describe("schema from scratch", () => {
  it.each(Object.entries(TABLES))("schema %s has all its tables", async (schema, expected) => {
    const { rows } = await c.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE'",
      [schema],
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...expected].sort());
  });

  it("has the views of the card", async () => {
    const { rows } = await c.query<{ v: string }>(
      "select schemaname || '.' || viewname as v from pg_views where schemaname = any($1)",
      [["pricing", "sales"]],
    );
    expect(rows.map((r) => r.v).sort()).toEqual([...VIEWS].sort());
  });

  it("has sales.apply_transition as SECURITY DEFINER owned by the migrator", async () => {
    const { rows } = await c.query<{ secdef: boolean; owner: string }>(
      `select p.prosecdef as secdef, pg_get_userbyid(p.proowner) as owner
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'sales' and p.proname = 'apply_transition'`,
    );
    expect(rows).toEqual([{ secdef: true, owner: "nivel_migrator" }]);
  });

  it("uses uuidv7 identifiers by default", async () => {
    const { rows } = await c.query<{ table_name: string; column_default: string }>(
      `select table_schema || '.' || table_name as table_name, column_default
         from information_schema.columns
        where table_schema = any($1) and column_name = 'id' and data_type = 'uuid'
          and table_name not like 'v\\_%' escape '\\'`,
      [SCHEMAS],
    );
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) expect(r.column_default, r.table_name).toContain("uuidv7()");
  });

  it("keeps money in bigint and rates in integer basis points", async () => {
    const { rows } = await c.query<{ t: string; col: string; data_type: string }>(
      `select table_schema || '.' || table_name as t, column_name as col, data_type
         from information_schema.columns
        where table_schema = any($1)
          and (column_name like '%\\_sum' escape '\\' or column_name like '%\\_bp' escape '\\')
          and table_name not like 'v\\_%' escape '\\'`,
      [SCHEMAS],
    );
    expect(rows.length).toBeGreaterThan(25);
    for (const r of rows) {
      const want = r.col.endsWith("_bp") ? "integer" : "bigint";
      expect(r.data_type, `${r.t}.${r.col}`).toBe(want);
    }
  });

  it("stores no floating point values anywhere", async () => {
    const { rows } = await c.query(
      `select table_schema, table_name, column_name from information_schema.columns
        where table_schema = any($1) and data_type in ('real', 'double precision')`,
      [SCHEMAS],
    );
    expect(rows).toEqual([]);
  });

  it("uses timestamptz for every timestamp", async () => {
    const { rows } = await c.query(
      `select table_schema, table_name, column_name from information_schema.columns
        where table_schema = any($1) and data_type = 'timestamp without time zone'`,
      [SCHEMAS],
    );
    expect(rows).toEqual([]);
  });
});

describe("catalog.products", () => {
  it("has STORED generated columns for compatibility filters with B-tree indexes", async () => {
    const { rows } = await c.query<{ column_name: string; is_generated: string }>(
      `select column_name, is_generated from information_schema.columns
        where table_schema = 'catalog' and table_name = 'products' and column_name like 'spec\\_%' escape '\\'
        order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: "spec_form_factor", is_generated: "ALWAYS" },
      { column_name: "spec_ram_type", is_generated: "ALWAYS" },
      { column_name: "spec_socket", is_generated: "ALWAYS" },
    ]);
    const { rows: idx } = await c.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'catalog' and tablename = 'products'",
    );
    const defs = idx.map((r) => r.indexdef);
    for (const col of ["spec_socket", "spec_ram_type", "spec_form_factor"])
      expect(
        defs.some((d) => d.includes(`USING btree (${col})`)),
        col,
      ).toBe(true);
  });

  it("has GIN jsonb_path_ops on specs, a trigram index and the (category, status) index", async () => {
    const { rows } = await c.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'catalog' and tablename = 'products'",
    );
    const defs = rows.map((r) => r.indexdef);
    expect(defs.some((d) => /USING gin \(specs jsonb_path_ops\)/.test(d))).toBe(true);
    expect(defs.some((d) => /gin_trgm_ops/.test(d) && /brand/.test(d) && /model/.test(d) && /mpn/.test(d))).toBe(true);
    expect(defs.some((d) => /\(category_code, status\)/.test(d))).toBe(true);
  });

  it("fills the STORED columns from specs (board and memory kit)", async () => {
    await c.query(
      `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
       values ('mb', 'pc', '{"uz":"Ona plata","ru":"Материнская плата"}', 'pc', 7, true, 2),
              ('ram', 'pc', '{"uz":"Xotira","ru":"Память"}', 'pc', 7, false, 3)
       on conflict (code) do nothing`,
    );
    const board = await c.query<{ spec_socket: string; spec_ram_type: string; spec_form_factor: string }>(
      `insert into catalog.products (slug, category_code, brand, model, specs)
       values ('test-board', 'mb', 'Test', 'Board', '{"socket":"AM5","ramType":"DDR5","formFactor":"mATX"}')
       returning spec_socket, spec_ram_type, spec_form_factor`,
    );
    expect(board.rows[0]).toEqual({ spec_socket: "AM5", spec_ram_type: "DDR5", spec_form_factor: "mATX" });
    const kit = await c.query<{ spec_ram_type: string }>(
      `insert into catalog.products (slug, category_code, brand, model, specs)
       values ('test-ram', 'ram', 'Test', 'Ram', '{"type":"DDR4"}') returning spec_ram_type`,
    );
    expect(kit.rows[0]?.spec_ram_type).toBe("DDR4");
  });
});
