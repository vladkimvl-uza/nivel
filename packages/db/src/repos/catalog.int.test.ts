import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import {
  createProduct,
  createRuleSetDraft,
  getBaseBuild,
  getLadder,
  getProduct,
  getProductBySlug,
  getPublishedRuleSet,
  listBaseBuilds,
  listCategories,
  listProducts,
  loadConfiguratorSnapshot,
  missingSpecKeys,
  publishRuleSet,
  retireProduct,
  searchProducts,
  verifyProduct,
} from "./catalog.ts";
import { setSetting } from "./ops.ts";
import { upsertFxRate } from "./pricing.ts";
import { connectAs, openDb, uniq } from "./testkit.ts";

const SEED_PATH = "../../seed/index.ts";
interface SeedModule {
  seedRules(c: pg.Client): Promise<unknown>;
  seedDemo(c: pg.Client, env: Record<string, string | undefined>): Promise<unknown>;
  DEMO_PRODUCTS: readonly { slug: string; price: number; vendors?: number }[];
}
const seed = (await import(/* @vite-ignore */ SEED_PATH)) as SeedModule;

let db: Db;
let m: pg.Client;

beforeAll(async () => {
  m = await connectAs("MIGRATOR");
  await m.query("begin");
  await seed.seedRules(m);
  await seed.seedDemo(m, {});
  await m.query("commit");
  db = openDb("ADMIN");
});
afterAll(async () => {
  await db.$client.end();
  await m.end();
});

describe("categories and positions", () => {
  it("lists the 29 categories in their order", async () => {
    const rows = await listCategories(db);
    expect(rows).toHaveLength(29);
    expect(rows[0]?.code).toBe("cpu");
    expect(rows.at(-1)?.code).toBe("os_license");
  });

  it("finds a position by id and by slug", async () => {
    const p = await getProductBySlug(db, "demo-r5-7500f");
    expect(p).toMatchObject({ brand: "AMD", model: "Ryzen 5 7500F", isDemo: true, status: "verified" });
    expect((await getProduct(db, p?.id as string))?.slug).toBe("demo-r5-7500f");
    expect(await getProduct(db, "00000000-0000-7000-8000-000000000000")).toBeNull();
    expect(await getProductBySlug(db, "nope")).toBeNull();
  });

  it("filters by category, status and the generated characteristic columns", async () => {
    const cpus = await listProducts(db, { category: "cpu" });
    expect(cpus).toHaveLength(10);
    const am5 = await listProducts(db, { category: "cpu", socket: "AM5" });
    expect(am5).toHaveLength(8);
    const ddr4 = await listProducts(db, { ramType: "DDR4" });
    expect(ddr4.map((p) => p.categoryCode).sort()).toEqual(["mb", "ram", "ram"]);
    const matx = await listProducts(db, { category: "mb", formFactor: "mATX" });
    expect(matx).toHaveLength(3);
    expect(await listProducts(db, { status: "draft" })).toEqual([]);
    expect((await listProducts(db, { isDemo: true })).length).toBe(seed.DEMO_PRODUCTS.length);
    expect(await listProducts(db, { isDemo: false })).toEqual([]);
    expect(await listProducts(db, {}, 3)).toHaveLength(3);
  });

  it("searches by brand, model or part number and forgives a typo", async () => {
    expect((await searchProducts(db, "ryzen 5 7500")).map((p) => p.slug)).toContain("demo-r5-7500f");
    expect((await searchProducts(db, "Gigabyte")).length).toBeGreaterThanOrEqual(4);
    expect((await searchProducts(db, "ryzem 7 9700x")).map((p) => p.slug)).toContain("demo-r7-9700x");
    expect(await searchProducts(db, "   ")).toEqual([]);
    expect(await searchProducts(db, "zzzzqqqq")).toEqual([]);
  });
});

describe("verification of a position", () => {
  const board = {
    categoryCode: "gpu" as const,
    brand: "Test",
    isDemo: true,
  };
  it("lists the keys the block rules still need", async () => {
    expect(await missingSpecKeys(db, "gpu", { lengthMm: 300 })).toEqual(["power", "tgpW"]);
    expect(await missingSpecKeys(db, "gpu", { lengthMm: 300, power: [], tgpW: null })).toEqual(["tgpW"]);
    expect(await missingSpecKeys(db, "decor", {})).toEqual([]);
  });

  it("refuses a draft with missing keys and verifies it once they are filled in", async () => {
    const id = await createProduct(db, {
      ...board,
      slug: `v-${uniq()}`,
      model: "Half",
      specs: { lengthMm: 300 },
      status: "draft",
    });
    expect(await verifyProduct(db, id, "00000000-0000-7000-8000-000000000000")).toEqual({
      ok: false,
      error: "incomplete_specs",
      missing: ["power", "tgpW"],
    });
    await db.$client.query("update catalog.products set specs = $2 where id = $1", [
      id,
      JSON.stringify({ lengthMm: 300, power: [{ conn: "8pin", count: 1 }], tgpW: 160 }),
    ]);
    await expect(verifyProduct(db, id, "00000000-0000-7000-8000-000000000000")).rejects.toMatchObject({
      code: "foreign_key_violation",
    });
    const u = await db.$client.query<{ id: string }>(
      "insert into ops.admin_users (email, password_hash, role) values ($1, 'x', 'owner') returning id",
      [`v${uniq()}@example.test`],
    );
    expect(await verifyProduct(db, id, u.rows[0]?.id as string)).toEqual({ ok: true });
    expect((await getProduct(db, id))?.status).toBe("verified");
    await retireProduct(db, id);
    expect((await getProduct(db, id))?.status).toBe("retired");
    expect(await verifyProduct(db, "00000000-0000-7000-8000-000000000000", "x")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("the database stops a direct write of an incomplete verified position", async () => {
    await expect(
      createProduct(db, {
        ...board,
        slug: `v-${uniq()}`,
        model: "Direct",
        specs: { lengthMm: 300 },
        status: "verified",
      }),
    ).rejects.toMatchObject({
      code: "check_violation",
      constraint: "products_verified_spec_complete_chk",
    });
  });
});

describe("rule sets", () => {
  it("has the seeded published set; publishing another one retires the previous", async () => {
    const first = await getPublishedRuleSet(db);
    expect(first?.version).toBe(1);
    expect(Object.keys(first?.payload ?? {})).toEqual(["compat", "selection"]);
    await createRuleSetDraft(db, 2, { compat: { psuMultiplier: 1.3 }, selection: {} });
    const u = await db.$client.query<{ id: string }>(
      "insert into ops.admin_users (email, password_hash, role) values ($1, 'x', 'owner') returning id",
      [`r${uniq()}@example.test`],
    );
    await publishRuleSet(db, 2, u.rows[0]?.id as string, { builds: 32, blocking: 0 });
    const now = await getPublishedRuleSet(db);
    expect(now?.version).toBe(2);
    expect(now?.goldenRun).toEqual({ builds: 32, blocking: 0 });
    const published = await db.$client.query(
      "select count(*)::int as n from catalog.rule_sets where status = 'published'",
    );
    expect(published.rows[0]?.n).toBe(1);
    await expect(publishRuleSet(db, 99, u.rows[0]?.id as string)).rejects.toThrow(/not found/);
    // The failed publication left version 2 published (one transaction).
    expect((await getPublishedRuleSet(db))?.version).toBe(2);
  });
});

describe("ladders and base builds", () => {
  it("reads a ladder from the weakest step to the strongest", async () => {
    const gpu = await getLadder(db, "gpu");
    expect(gpu.map((s) => s.key)).toEqual([
      "gpu.rtx5050",
      "gpu.rtx5060",
      "gpu.rtx5060ti16",
      "gpu.rtx5070",
      "gpu.rx9070xt",
      "gpu.rtx5070ti",
      "gpu.rtx5080",
      "gpu.rtx5090",
    ]);
    expect(gpu.at(-1)).toMatchObject({ manualOnly: true, step: 8 });
    expect(gpu[0]?.name.ru).toContain("RTX 5050");
    expect((await getLadder(db, "ssd")).map((s) => s.key)).toEqual(["ssd.512", "ssd.1tb", "ssd.2tb"]);
  });

  it("lists base builds by style, task and status", async () => {
    expect(await listBaseBuilds(db)).toHaveLength(42);
    expect(await listBaseBuilds(db, { style: "A", status: "offered" })).toHaveLength(17);
    expect(await listBaseBuilds(db, { task: "office" })).toHaveLength(2 * 5);
    const notOffered = await listBaseBuilds(db, { status: "not_offered" });
    expect(notOffered).toHaveLength(8);
    expect(notOffered.every((b) => b.redirectTask !== null && b.explain?.uz && b.explain.ru)).toBe(true);
    expect((await listBaseBuilds(db, { showcaseOnly: true })).map((b) => `${b.task} ${b.tier}`).sort()).toEqual([
      "design3d T2",
      "gaming T2",
      "gaming T3",
      "office T1",
      "programming T2",
      "streaming T2",
    ]);
  });

  it("returns one cell with its rows in order and the price class keys", async () => {
    const b = await getBaseBuild(db, { task: "gaming", tier: "T3", style: "B" });
    expect(b?.items.map((i) => i.classKey)).toContain("psu.750_gold_white");
    expect(b?.items.at(-1)?.classKey).toBe("fan.white_x3");
    expect(b?.items.find((i) => i.slot === "gpu")).toMatchObject({ classKey: "gpu.rtx5070", role: "primary", qty: 1 });
    expect(b?.items.find((i) => i.slot === "cpu")?.role).toBe("secondary");
    expect(b?.items.find((i) => i.slot === "psu")?.role).toBe("support");
    const plus = await getBaseBuild(db, { task: "office", tier: "T1", style: "A", variant: "plus" });
    expect(plus?.explain?.ru).toContain("Т1+");
    const no = await getBaseBuild(db, { task: "streaming", tier: "T1", style: "A" });
    expect(no).toMatchObject({ status: "not_offered", redirectTask: "gaming" });
    expect(no?.items).toEqual([]);
    expect(await getBaseBuild(db, { task: "office", tier: "T4", style: "A", variant: "plus" })).toBeNull();
  });
});

describe("snapshot of the configurator", () => {
  it("brings verified positions with their current prices, the rules, the money settings and the rate", async () => {
    await upsertFxRate(db, { ccy: "USD", rate: "12000.5000", effectiveDate: "2026-10-06", source: "cbu_json" });
    await setSetting(db, "money.fee_settings", { version: "test", pcLowRateBp: 1500 }, "owner");
    const snap = await loadConfiguratorSnapshot(db);
    expect(snap.ruleSet?.version).toBeGreaterThanOrEqual(1);
    expect(snap.feeSettings).toMatchObject({ pcLowRateBp: 1500 });
    expect(snap.usd).toEqual({ rate: "12000.5000", effectiveDate: "2026-10-06" });
    const r5 = snap.products.find((p) => p.slug === "demo-r5-7500f");
    expect(r5).toMatchObject({ medianSum: 1_413_000, confidence: "medium" });
    expect(r5?.fromSum).toBeLessThan(1_413_000);
    const rtx = snap.products.find((p) => p.slug === "demo-gpu-5070");
    expect(rtx).toMatchObject({ medianSum: null, confidence: "low" });
    expect(rtx?.fromSum).toBeGreaterThan(0);
    expect(snap.products.every((p) => p.status === "verified")).toBe(true);
    // A position without any price still arrives, with null prices.
    const id = await createProduct(db, {
      categoryCode: "fan",
      brand: "Test",
      model: "NoPrice",
      slug: `np-${uniq()}`,
      specs: {},
      status: "verified",
    });
    const again = await loadConfiguratorSnapshot(db);
    expect(again.products.find((p) => p.id === id)).toMatchObject({ medianSum: null, fromSum: null, confidence: null });
  });
});
