// The slice of the catalog a calculation needs: the positions of the lines, their market prices, the fee group and
// returnability of their categories, the compatibility thresholds of the published rule set. Only verified positions
// are quoted; a draft or retired one is "not in the catalog" for the caller (ARCHITECTURE 4.3, 4.5).
import { ProductSpecsSchema } from "@nivel/contracts/catalog";
import type { Executor } from "@nivel/db/repos";
import { catalog } from "@nivel/db/repos";
import {
  type CatalogLookup,
  type CategoryCode,
  createCatalogLookup,
  type FeeGroup,
  type Product,
  type ProductId,
} from "@nivel/domain/catalog";
import { type CompatSettings, defaultCompatSettings } from "@nivel/domain/compat";
import { dsl } from "../orders/dsl.ts";
import { ConfigError } from "../orders/errors.ts";
import { isUuid } from "../orders/validate.ts";

export interface MarketRow {
  asOf: string;
  median: number | null;
  from: number | null;
  confidence: "high" | "medium" | "low";
  isDemo: boolean;
}

export interface CatalogView {
  lookup: CatalogLookup;
  prices: Map<ProductId, MarketRow>;
  categories: Map<CategoryCode, { feeGroup: FeeGroup; returnable: boolean }>;
  compat: CompatSettings;
  ruleSetVersion: number | null;
}

const NUMERIC_COMPAT_KEYS = [
  "gpuLenWarnMarginMm",
  "coolerHeightWarnMarginMm",
  "psuMultiplier",
  "psuHeadroomWarnBp",
  "baseW",
  "perFanW",
  "pumpW",
  "rollbackZoneMm",
] as const;

/** Thresholds of the published rule set over the defaults of the domain; a broken value is a ConfigError. */
export function compatSettingsFrom(payload: unknown): CompatSettings {
  const defaults = defaultCompatSettings();
  const raw = (payload as { compat?: unknown } | null)?.compat;
  if (raw === undefined || raw === null) return defaults;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError("rule set: compat must be an object");
  const merged = { ...defaults, ...(raw as Record<string, unknown>) } as Record<string, unknown>;
  for (const key of NUMERIC_COMPAT_KEYS) {
    if (typeof merged[key] !== "number" || !Number.isFinite(merged[key])) {
      throw new ConfigError(`rule set: compat.${key} must be a number`);
    }
  }
  const series = merged.psuSeriesW;
  if (!Array.isArray(series) || series.some((w) => typeof w !== "number")) {
    throw new ConfigError("rule set: compat.psuSeriesW must be a list of numbers");
  }
  for (const key of ["eyeDistanceMm", "standDepthMm"] as const) {
    const pair = merged[key];
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((n) => typeof n !== "number")) {
      throw new ConfigError(`rule set: compat.${key} must be a pair of numbers`);
    }
  }
  return merged as unknown as CompatSettings;
}

export async function loadCatalogFor(ex: Executor, productIds: readonly string[]): Promise<CatalogView> {
  const { sql } = dsl(ex);
  // An id that is not a uuid cannot be a product; asking the database would fail with a syntax error.
  const ids = [...new Set(productIds.filter(isUuid))];

  const categoryRows = await catalog.listCategories(ex);
  const categories = new Map<CategoryCode, { feeGroup: FeeGroup; returnable: boolean }>(
    categoryRows.map((c) => [c.code, { feeGroup: c.feeGroupDefault, returnable: c.returnableDefault }]),
  );

  const products: Product[] = [];
  const prices = new Map<ProductId, MarketRow>();
  if (ids.length > 0) {
    const rows = await ex.query.products.findMany({
      where: (t, { and, eq, inArray }) => and(inArray(t.id, ids), eq(t.status, "verified")),
    });
    for (const row of rows) {
      const parsed = ProductSpecsSchema.safeParse({ category: row.categoryCode, spec: row.specs });
      if (!parsed.success) continue; // malformed specs: the position stays out of the catalog, the line is refused
      const fallback = categories.get(row.categoryCode);
      products.push({
        id: row.id as ProductId,
        brand: row.brand,
        model: row.model,
        ...(row.mpn === null ? {} : { mpn: row.mpn }),
        ...(row.priceClassId === null ? {} : { priceClassId: row.priceClassId }),
        ...(row.ladderStep === null ? {} : { ladderStep: row.ladderStep }),
        color: row.colorBody,
        lighting: row.lighting,
        feeGroup: row.feeGroup ?? fallback?.feeGroup ?? "pc",
        returnable: row.returnable ?? fallback?.returnable ?? true,
        manualOnly: row.manualOnly,
        status: row.status,
        isDemo: row.isDemo,
        ...parsed.data,
      } as Product);
    }
    const found = products.map((p) => p.id);
    if (found.length > 0) {
      const { rows: priceRows } = await ex.execute<{
        product_id: string;
        as_of: string;
        median_sum: string | null;
        from_sum: string | null;
        confidence: "high" | "medium" | "low";
        is_demo: boolean;
      }>(
        sql`select product_id::text, as_of::text, median_sum::text, from_sum::text, confidence, is_demo
              from pricing.v_market_price_current where product_id in ${found}`,
      );
      for (const r of priceRows) {
        prices.set(r.product_id as ProductId, {
          asOf: r.as_of,
          median: r.median_sum === null ? null : Number(r.median_sum),
          from: r.from_sum === null ? null : Number(r.from_sum),
          confidence: r.confidence,
          isDemo: r.is_demo,
        });
      }
    }
  }

  const ruleSet = await catalog.getPublishedRuleSet(ex);
  return {
    lookup: createCatalogLookup(products),
    prices,
    categories,
    compat: compatSettingsFrom(ruleSet?.payload),
    ruleSetVersion: ruleSet?.version ?? null,
  };
}
