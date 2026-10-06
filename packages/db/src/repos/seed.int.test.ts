import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, one, pgError } from "./testkit.ts";

// WP-06 acceptance: migrations from scratch on a test database; `db:reset` raises the database with the demo layer.
const SEED_PATH = "../../seed/index.ts";
interface SeedModule {
  seedRules(client: pg.Client, env?: Record<string, string | undefined>): Promise<Record<string, number>>;
  seedDemo(client: pg.Client, env: Record<string, string | undefined>): Promise<Record<string, number | boolean>>;
  seedAll(
    url: string,
    env: Record<string, string | undefined>,
  ): Promise<{ rules: Record<string, number>; demo: Record<string, number | boolean> | null }>;
  resetDatabase(
    url: string,
    env: Record<string, string | undefined>,
  ): Promise<{ rules: Record<string, number>; demo: Record<string, number | boolean> | null }>;
  DEMO_PRODUCTS: readonly { slug: string; classKey: string; price: number; vendors?: number }[];
}
const seed = (await import(/* @vite-ignore */ SEED_PATH)) as SeedModule;
const CLI = fileURLToPath(new URL("../../seed/cli.ts", import.meta.url));
const CLI_PATH = "../../seed/cli.ts";
const cli = (await import(/* @vite-ignore */ CLI_PATH)) as {
  run(
    command: string | undefined,
    url: string | undefined,
    env?: Record<string, string | undefined>,
  ): Promise<{ rules: Record<string, number>; demo: unknown }>;
};

let c: pg.Client;
let migratorUrl: string;

beforeAll(async () => {
  c = await connectAs("MIGRATOR");
  migratorUrl = process.env.DATABASE_URL_MIGRATOR as string;
});
afterAll(async () => {
  await c.end();
});

const count = async (sql: string, values: unknown[] = []) =>
  Number((await one<{ n: string }>(c, `select count(*)::text as n from ${sql}`, values)).n);

describe("rule seed", () => {
  it("fills categories, ladders, price classes, the 32 templates and the money settings", async () => {
    await c.query("begin");
    try {
      const r = await seed.seedRules(c);
      expect(r).toMatchObject({ categories: 29, ladders: 5 });
      expect(await count("catalog.categories")).toBe(29);
      expect(await count("catalog.ladders")).toBe(5);
      expect(await count("catalog.price_classes")).toBe(r.priceClasses);
      // 32 offered + 8 not offered + 2 "Office T1+" (one per style)
      expect(await count("catalog.base_builds")).toBe(42);
      expect(await count("catalog.base_builds where status = 'offered' and variant = 'base'")).toBe(32);
      expect(await count("catalog.base_builds where status = 'not_offered' and redirect_task is not null")).toBe(8);
      expect(await count("catalog.base_builds where variant = 'plus'")).toBe(2);
      expect(await count("catalog.base_build_items")).toBe(r.baseBuildItems);
      expect(await count("catalog.rule_sets where status = 'published'")).toBe(1);
      const fee = await one<{ value: { pcLowRateBp: number; minFullCyclePc: number; afterTestsRetainBp: number } }>(
        c,
        "select value from ops.settings where key = 'money.fee_settings'",
      );
      expect(fee.value).toMatchObject({ pcLowRateBp: 1500, minFullCyclePc: 6_700_000, afterTestsRetainBp: 8500 });
      const flags = await c.query("select key, value from ops.settings where key like 'feature.%' order by key");
      expect(flags.rows.map((x) => x.value)).toEqual([false, false, false, false]);
    } finally {
      await c.query("rollback");
    }
  });

  it("is repeatable: a second run changes no counts and keeps what the owner changed", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      await c.query("update ops.settings set value = '999' where key = 'feature.ai'");
      const before = [
        await count("catalog.base_builds"),
        await count("catalog.base_build_items"),
        await count("catalog.price_classes"),
      ];
      await seed.seedRules(c);
      const after = [
        await count("catalog.base_builds"),
        await count("catalog.base_build_items"),
        await count("catalog.price_classes"),
      ];
      expect(after).toEqual(before);
      const ai = await one<{ value: unknown }>(c, "select value from ops.settings where key = 'feature.ai'");
      expect(ai.value).toBe(999);
    } finally {
      await c.query("rollback");
    }
  });

  it.each(["production", "staging"])(
    "in %s adds only what is missing and keeps what the owner edited in the admin",
    async (mode) => {
      await c.query("begin");
      try {
        await seed.seedRules(c, { APP_MODE: "development" });
        await c.query("update catalog.categories set freshness_days = 99 where code = (select min(code) from catalog.categories)");
        await c.query("update catalog.base_builds set status = 'not_offered', redirect_task = 'gaming' where id = (select min(id::text)::uuid from catalog.base_builds where status = 'offered')");
        await c.query("delete from catalog.base_build_items where base_build_id in (select id from catalog.base_builds where status = 'offered' and task = 'office' and tier = 'T1' and variant = 'base')");
        await c.query("update catalog.price_classes set step = step + 100 where key = 'gpu.rtx5050'");
        await c.query("update catalog.ladders set steps = '{}' where code = 'gpu'");
        const edited = [
          await count("catalog.categories where freshness_days = 99"),
          await count("catalog.base_builds where status = 'not_offered' and redirect_task = 'gaming'"),
          await count("catalog.base_build_items"),
        ];
        await seed.seedRules(c, { APP_MODE: mode });
        // Edits stay; an empty ladder (new in the code) is filled; nothing the owner changed is reset.
        expect(await count("catalog.categories where freshness_days = 99")).toBe(edited[0]);
        expect(await count("catalog.base_builds where status = 'not_offered' and redirect_task = 'gaming'")).toBe(edited[1]);
        expect(await count("catalog.base_build_items")).toBe(edited[2]);
        expect(await count("catalog.price_classes where key = 'gpu.rtx5050' and step >= 100")).toBe(1);
        expect(await count("catalog.ladders where code = 'gpu' and cardinality(steps) > 0")).toBe(1);
        // A missing row is added.
        await c.query("delete from catalog.base_build_items");
        await c.query("delete from catalog.base_builds");
        await seed.seedRules(c, { APP_MODE: mode });
        expect(await count("catalog.base_builds")).toBe(42);
        expect(await count("catalog.base_build_items")).toBeGreaterThan(0);
        // Development brings everything back to the code.
        await seed.seedRules(c, { APP_MODE: "development" });
        expect(await count("catalog.categories where freshness_days = 99")).toBe(0);
        expect(await count("catalog.price_classes where key = 'gpu.rtx5050' and step >= 100")).toBe(0);
      } finally {
        await c.query("rollback");
      }
    },
  );

  it("orders each ladder by step and writes the primary classes into ladders.steps", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      const { rows } = await c.query<{ code: string; keys: string[] }>(
        `select l.code, array(select pc.key from unnest(l.steps) with ordinality u(id, n)
                              join catalog.price_classes pc on pc.id = u.id order by u.n) as keys
           from catalog.ladders l order by l.code`,
      );
      const by = Object.fromEntries(rows.map((r) => [r.code, r.keys]));
      expect(by.gpu?.[0]).toBe("gpu.rtx5050");
      expect(by.gpu?.at(-1)).toBe("gpu.rtx5090");
      expect(by.ram).toEqual(["ram.ddr5_16", "ram.ddr5_32", "ram.ddr5_64", "ram.ddr5_128"]);
      expect(by.ssd).toEqual(["ssd.512", "ssd.1tb", "ssd.2tb"]);
      expect(by.cpu_am5?.[0]).toBe("cpu.r5_7500f");
    } finally {
      await c.query("rollback");
    }
  });

  it("makes Office T1+ share the items of Programming T1, in both styles", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      const items = async (task: string, variant: string, style: string) =>
        (
          await c.query<{ key: string; qty: number }>(
            `select pc.key, i.qty from catalog.base_builds b
               join catalog.base_build_items i on i.base_build_id = b.id
               join catalog.price_classes pc on pc.id = i.price_class_id
              where b.task = $1 and b.tier = 'T1' and b.variant = $2 and b.style = $3 order by i.position`,
            [task, variant, style],
          )
        ).rows;
      for (const style of ["A", "B"]) {
        const plus = await items("office", "plus", style);
        expect(plus.length).toBeGreaterThan(5);
        expect(plus).toEqual(await items("programming", "base", style));
      }
    } finally {
      await c.query("rollback");
    }
  });
});

describe("demo seed", () => {
  it("fills positions, observations and market prices with is_demo, and the median equals the table price", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      const r = await seed.seedDemo(c, {});
      expect(r.skipped).toBe(false);
      expect(r.products).toBe(seed.DEMO_PRODUCTS.length);
      expect(await count("catalog.products where is_demo")).toBe(seed.DEMO_PRODUCTS.length);
      expect(await count("catalog.products where not is_demo")).toBe(0);
      expect(await count("catalog.products where status = 'verified'")).toBe(seed.DEMO_PRODUCTS.length);
      expect(await count("pricing.price_observations where not is_demo")).toBe(0);
      expect(await count("pricing.market_prices where not is_demo")).toBe(0);
      expect(await count("pricing.vendors where not is_demo")).toBe(0);
      expect(await count("pricing.fx_rates where ccy = 'USD' and rate = 11772.9500")).toBe(1);

      const { rows } = await c.query<{
        slug: string;
        median_sum: string | null;
        confidence: string;
        vendors_n: number;
      }>(
        `select p.slug, v.median_sum::text, v.confidence, v.vendors_n
           from pricing.v_market_price_current v join catalog.products p on p.id = v.product_id`,
      );
      const by = new Map(rows.map((x) => [x.slug, x]));
      for (const p of seed.DEMO_PRODUCTS.filter((x) => (x.vendors ?? 3) === 3)) {
        expect(Number(by.get(p.slug)?.median_sum), p.slug).toBe(p.price);
        expect(by.get(p.slug)?.confidence).toBe("medium");
      }
      expect(by.get("demo-gpu-5070")).toMatchObject({ median_sum: null, confidence: "low", vendors_n: 2 });
      expect(by.get("demo-ddr5-128")).toMatchObject({ median_sum: null, confidence: "low", vendors_n: 1 });
      const manual = await count("catalog.products where manual_only");
      expect(manual).toBe(1);
      expect(await count("catalog.base_builds where is_showcase")).toBe(6);
      expect(await count("content.idea_posts where is_demo and status = 'published'")).toBe(2);
    } finally {
      await c.query("rollback");
    }
  });

  it("derives the generated characteristic columns of the demo positions", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      await seed.seedDemo(c, {});
      const b = await one<{ spec_socket: string; spec_ram_type: string; spec_form_factor: string }>(
        c,
        "select spec_socket, spec_ram_type, spec_form_factor from catalog.products where slug = 'demo-b850m-force'",
      );
      expect(b).toEqual({ spec_socket: "AM5", spec_ram_type: "DDR5", spec_form_factor: "mATX" });
      const m = await one<{ spec_ram_type: string }>(
        c,
        "select spec_ram_type from catalog.products where slug = 'demo-ddr4-16-2x8'",
      );
      expect(m.spec_ram_type).toBe("DDR4");
    } finally {
      await c.query("rollback");
    }
  });

  it("does nothing the second time", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      await seed.seedDemo(c, {});
      const again = await seed.seedDemo(c, {});
      expect(again.skipped).toBe(true);
      expect(await count("catalog.products")).toBe(seed.DEMO_PRODUCTS.length);
    } finally {
      await c.query("rollback");
    }
  });

  it("refuses at APP_MODE=production and writes nothing", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      await expect(seed.seedDemo(c, { APP_MODE: "production" })).rejects.toThrow(/production/);
      expect(await count("catalog.products")).toBe(0);
      expect(await count("pricing.vendors")).toBe(0);
    } finally {
      await c.query("rollback");
    }
  });

  it("keeps the demo rows visible to tools/check-demo.mjs, which production runs to find them", async () => {
    await c.query("begin");
    try {
      await seed.seedRules(c);
      await seed.seedDemo(c, {});
      // Same queries as the production launch check, on the open transaction.
      const checkPath = "../../../../tools/check-demo.mjs";
      const { DEMO_CHECKS } = (await import(/* @vite-ignore */ checkPath)) as {
        DEMO_CHECKS: { table: string; sql: string }[];
      };
      const problems: string[] = [];
      for (const check of DEMO_CHECKS) {
        const r = await c.query<{ n: number }>(check.sql);
        if ((r.rows[0]?.n ?? 0) > 0) problems.push(check.table);
      }
      expect(problems.sort()).toEqual([
        "catalog.base_builds",
        "catalog.products",
        "content.idea_posts",
        "pricing.market_prices",
      ]);
    } finally {
      await c.query("rollback");
    }
  });
});

describe("seedAll and reset", () => {
  it("seeds only the rules when the environment is production", async () => {
    const r = await seed.resetDatabase(migratorUrl, { APP_MODE: "development" });
    expect(r.demo?.skipped).toBe(false);
    const prod = await seed.seedAll(migratorUrl, { APP_MODE: "production" });
    expect(prod.demo).toBeNull();
    expect(prod.rules.categories).toBe(29);
  });

  it("rebuilds the database from zero and brings back the demo (pnpm db:reset)", async () => {
    await c.query("insert into ops.settings (key, value) values ('junk.key', '1')");
    const r = await seed.resetDatabase(migratorUrl, { APP_MODE: "development" });
    expect(r.rules.categories).toBe(29);
    expect(r.demo?.products).toBe(seed.DEMO_PRODUCTS.length);
    const junk = await c.query("select 1 from ops.settings where key = 'junk.key'");
    expect(junk.rowCount).toBe(0);
    // Migrated again: the journal has the migrations and a trigger works.
    const journal = await one<{ n: string }>(c, "select count(*)::text as n from drizzle.__drizzle_migrations");
    expect(Number(journal.n)).toBeGreaterThanOrEqual(4);
    await c.query("insert into ops.audit_log (actor, action, entity) values ('test', 'a', 'b')");
    const e = await pgError(c, "update ops.audit_log set action = 'x'");
    expect(e.message).toMatch(/append_only/);
    expect(await count("catalog.products where is_demo")).toBe(seed.DEMO_PRODUCTS.length);
    // The roles still work after the schemas were recreated: the site reads the catalog, not the payments.
    const web = await connectAs("WEB");
    try {
      await web.query("select 1 from catalog.products limit 1");
      expect((await pgError(web, "select 1 from sales.payments")).code).toBe("42501");
    } finally {
      await web.end();
    }
  });

  it("refuses to reset in production and writes nothing", async () => {
    await expect(seed.resetDatabase(migratorUrl, { APP_MODE: "production" })).rejects.toThrow(/production/);
    expect(await count("catalog.products where is_demo")).toBeGreaterThan(0);
  });

  it("runs a command in process: seed is repeatable, unknown commands and a missing URL are refused", async () => {
    const first = await cli.run("seed", migratorUrl, { APP_MODE: "development" });
    expect(first.rules.categories).toBe(29);
    const second = await cli.run("seed", migratorUrl, { APP_MODE: "development" });
    expect(second.demo).toMatchObject({ skipped: true });
    await expect(cli.run("drop", migratorUrl)).rejects.toThrow(/usage/);
    await expect(cli.run(undefined, migratorUrl)).rejects.toThrow(/usage/);
    await expect(cli.run("seed", undefined)).rejects.toThrow(/DATABASE_URL_MIGRATOR/);
  });

  it("runs from the command line with the migrator role: node seed/cli.ts reset", () => {
    const run = (arg: string, mode = "development") =>
      spawnSync(process.execPath, [CLI, arg], {
        env: { ...process.env, APP_MODE: mode, NODE_NO_WARNINGS: "1" },
        encoding: "utf8",
        timeout: 60_000,
      });
    const reset = run("reset");
    expect(reset.status, reset.stderr).toBe(0);
    expect(JSON.parse(reset.stdout.trim().split("\n").at(-1) ?? "{}")).toMatchObject({ rules: { categories: 29 } });
    const prodReset = run("reset", "production");
    expect(prodReset.status).toBe(1);
    expect(prodReset.stderr).toMatch(/reset refused/);
    expect(run("unknown").status).toBe(1);
  });
});
