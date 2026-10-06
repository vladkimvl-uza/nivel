// Repositories of the catalog schema: categories, positions, price classes and ladders, rule sets, base builds
// (ARCHITECTURE 3.3, 4.3, 4.11) and the one-query snapshot for the configurator (3.5).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  baseBuildItems,
  baseBuilds,
  categories,
  ladders,
  priceClasses,
  products,
  ruleSets,
} from "../schema/catalog.ts";
import { fxRates } from "../schema/pricing.ts";
import { guarded } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { getSetting } from "./ops.ts";

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = Omit<
  typeof products.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "specSocket" | "specRamType" | "specFormFactor"
>;

export async function listCategories(db: Executor) {
  return db.select().from(categories).orderBy(asc(categories.sort), asc(categories.code));
}

export async function createProduct(db: Executor, input: ProductInsert): Promise<string> {
  const [row] = await guarded(() => db.insert(products).values(input).returning({ id: products.id }));
  if (!row) throw new Error("product was not written");
  return row.id;
}

export async function getProduct(db: Executor, id: string): Promise<ProductRow | null> {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row ?? null;
}

export async function getProductBySlug(db: Executor, slug: string): Promise<ProductRow | null> {
  const [row] = await db.select().from(products).where(eq(products.slug, slug));
  return row ?? null;
}

export interface ProductFilter {
  category?: ProductRow["categoryCode"];
  status?: ProductRow["status"];
  isDemo?: boolean;
  socket?: string;
  ramType?: string;
  formFactor?: string;
}

/** Positions by category and status, filtered by the STORED characteristic columns (B-tree indexed). */
export async function listProducts(db: Executor, f: ProductFilter = {}, limit = 500): Promise<ProductRow[]> {
  const where = [
    f.category ? eq(products.categoryCode, f.category) : undefined,
    f.status ? eq(products.status, f.status) : undefined,
    f.isDemo !== undefined ? eq(products.isDemo, f.isDemo) : undefined,
    f.socket ? eq(products.specSocket, f.socket) : undefined,
    f.ramType ? eq(products.specRamType, f.ramType) : undefined,
    f.formFactor ? eq(products.specFormFactor, f.formFactor) : undefined,
  ].filter((x) => x !== undefined);
  return db
    .select()
    .from(products)
    .where(and(...where))
    .orderBy(asc(products.categoryCode), asc(products.brand), asc(products.model))
    .limit(limit);
}

/** Search by brand, model or part number; a typo still finds the position (pg_trgm similarity). */
export async function searchProducts(db: Executor, query: string, limit = 20): Promise<ProductRow[]> {
  const needle = query.trim();
  if (needle === "") return [];
  const haystack = sql`(${products.brand} || ' ' || ${products.model} || ' ' || coalesce(${products.mpn}, ''))`;
  return db
    .select()
    .from(products)
    .where(sql`${haystack} ilike ${`%${needle}%`} or similarity(${haystack}, ${needle}) > 0.25`)
    .orderBy(sql`similarity(${haystack}, ${needle}) desc`, asc(products.model))
    .limit(limit);
}

/** Keys the "block" rules need for this category that the characteristics lack (empty: the position can be verified). */
export async function missingSpecKeys(
  db: Executor,
  category: string,
  specs: Record<string, unknown>,
): Promise<string[]> {
  const { rows } = await db.execute<{ k: string }>(sql`
    select k from unnest(catalog.required_spec_keys(${category})) as k
     where (${JSON.stringify(specs)}::jsonb) -> k is null or jsonb_typeof((${JSON.stringify(specs)}::jsonb) -> k) = 'null'
     order by k`);
  return rows.map((r) => r.k);
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "incomplete_specs"; missing: string[] };

/** draft -> verified; the database CHECK refuses a position whose rule fields are not all filled in. */
export async function verifyProduct(db: Executor, id: string, verifiedBy: string): Promise<VerifyResult> {
  const product = await getProduct(db, id);
  if (!product) return { ok: false, error: "not_found" };
  const missing = await missingSpecKeys(db, product.categoryCode, product.specs);
  if (missing.length > 0) return { ok: false, error: "incomplete_specs", missing };
  await guarded(() => db.update(products).set({ status: "verified", verifiedBy }).where(eq(products.id, id)));
  return { ok: true };
}

export async function retireProduct(db: Executor, id: string): Promise<void> {
  await db.update(products).set({ status: "retired" }).where(eq(products.id, id));
}

// ---- rules ------------------------------------------------------------------------------------------------------
export async function getPublishedRuleSet(db: Executor) {
  const [row] = await db.select().from(ruleSets).where(eq(ruleSets.status, "published"));
  return row ?? null;
}

/** Publishes a draft rule set and takes the previous one back to draft: there is exactly one published set. */
export async function publishRuleSet(
  db: Executor,
  version: number,
  by: string,
  goldenRun?: Record<string, unknown>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(ruleSets).set({ status: "draft" }).where(eq(ruleSets.status, "published"));
    const rows = await guarded(() =>
      tx
        .update(ruleSets)
        .set({ status: "published", publishedAt: new Date(), publishedBy: by, ...(goldenRun ? { goldenRun } : {}) })
        .where(eq(ruleSets.version, version))
        .returning({ id: ruleSets.id }),
    );
    if (rows.length === 0) throw new Error(`rule set version ${version} not found`);
  });
}

export async function createRuleSetDraft(
  db: Executor,
  version: number,
  payload: Record<string, unknown>,
): Promise<string> {
  const [row] = await guarded(() =>
    db.insert(ruleSets).values({ version, payload, status: "draft" }).returning({ id: ruleSets.id }),
  );
  if (!row) throw new Error("rule set was not written");
  return row.id;
}

// ---- ladders and base builds ------------------------------------------------------------------------------------
export interface LadderStep {
  step: number | null;
  key: string;
  name: { uz: string; ru: string };
  manualOnly: boolean;
}

/** The classes of a ladder from the weakest to the strongest step (the primary class of every step). */
export async function getLadder(db: Executor, code: (typeof ladders.$inferSelect)["code"]): Promise<LadderStep[]> {
  const [ladder] = await db.select().from(ladders).where(eq(ladders.code, code));
  if (!ladder || ladder.steps.length === 0) return [];
  const classes = await db.select().from(priceClasses).where(inArray(priceClasses.id, ladder.steps));
  const by = new Map(classes.map((c) => [c.id, c]));
  return ladder.steps.flatMap((id) => {
    const c = by.get(id);
    return c ? [{ step: c.step, key: c.key, name: c.name, manualOnly: c.manualOnly }] : [];
  });
}

export interface BaseBuildFilter {
  style?: "A" | "B";
  task?: (typeof baseBuilds.$inferSelect)["task"];
  status?: "offered" | "not_offered";
  showcaseOnly?: boolean;
}

export async function listBaseBuilds(db: Executor, f: BaseBuildFilter = {}) {
  const where = [
    f.style ? eq(baseBuilds.style, f.style) : undefined,
    f.task ? eq(baseBuilds.task, f.task) : undefined,
    f.status ? eq(baseBuilds.status, f.status) : undefined,
    f.showcaseOnly ? eq(baseBuilds.isShowcase, true) : undefined,
  ].filter((x) => x !== undefined);
  return db
    .select()
    .from(baseBuilds)
    .where(and(...where))
    .orderBy(asc(baseBuilds.task), asc(baseBuilds.tier), asc(baseBuilds.style), asc(baseBuilds.variant));
}

export interface BaseBuildItem {
  position: number;
  slot: string;
  classKey: string | null;
  productId: string | null;
  qty: number;
  role: string;
}

/** One cell of the table of block 28: task, tier, style, variant, with its rows in order. */
export async function getBaseBuild(
  db: Executor,
  cell: {
    task: (typeof baseBuilds.$inferSelect)["task"];
    tier: (typeof baseBuilds.$inferSelect)["tier"];
    style: "A" | "B";
    variant?: "base" | "plus";
  },
) {
  const [build] = await db
    .select()
    .from(baseBuilds)
    .where(
      and(
        eq(baseBuilds.task, cell.task),
        eq(baseBuilds.tier, cell.tier),
        eq(baseBuilds.style, cell.style),
        eq(baseBuilds.variant, cell.variant ?? "base"),
      ),
    );
  if (!build) return null;
  const rows = await db
    .select({
      position: baseBuildItems.position,
      slot: baseBuildItems.slot,
      classKey: priceClasses.key,
      productId: baseBuildItems.productId,
      qty: baseBuildItems.qty,
      role: baseBuildItems.role,
    })
    .from(baseBuildItems)
    .leftJoin(priceClasses, eq(priceClasses.id, baseBuildItems.priceClassId))
    .where(eq(baseBuildItems.baseBuildId, build.id))
    .orderBy(asc(baseBuildItems.position));
  return { ...build, items: rows satisfies BaseBuildItem[] };
}

// ---- the snapshot of the configurator ---------------------------------------------------------------------------
export interface ConfiguratorSnapshot {
  ruleSet: { version: number; payload: Record<string, unknown> } | null;
  feeSettings: unknown;
  usd: { rate: string; effectiveDate: string } | null;
  products: (ProductRow & {
    medianSum: number | null;
    fromSum: number | null;
    confidence: "high" | "medium" | "low" | null;
  })[];
}

/** Verified positions with the current market prices, the published rules, the money settings and the rate. */
export async function loadConfiguratorSnapshot(db: Executor): Promise<ConfiguratorSnapshot> {
  const [ruleSet, fee, usd] = await Promise.all([
    getPublishedRuleSet(db),
    getSetting(db, "money.fee_settings"),
    db.select().from(fxRates).where(eq(fxRates.ccy, "USD")).orderBy(sql`${fxRates.effectiveDate} desc`).limit(1),
  ]);
  const { rows } = await db.execute<{
    id: string;
    median_sum: string | null;
    from_sum: string | null;
    confidence: "high" | "medium" | "low" | null;
  }>(sql`
    select p.id, v.median_sum::text, v.from_sum::text, v.confidence
      from catalog.products p left join pricing.v_market_price_current v on v.product_id = p.id
     where p.status = 'verified' order by p.category_code, p.brand, p.model`);
  const price = new Map(rows.map((r) => [r.id, r]));
  const list = await listProducts(db, { status: "verified" }, 1000);
  return {
    ruleSet: ruleSet ? { version: ruleSet.version, payload: ruleSet.payload } : null,
    feeSettings: fee?.value ?? null,
    usd: usd[0] ? { rate: usd[0].rate, effectiveDate: usd[0].effectiveDate } : null,
    products: list.map((p) => {
      const r = price.get(p.id);
      return {
        ...p,
        medianSum: r?.median_sum != null ? Number(r.median_sum) : null,
        fromSum: r?.from_sum != null ? Number(r.from_sum) : null,
        confidence: r?.confidence ?? null,
      };
    }),
  };
}
