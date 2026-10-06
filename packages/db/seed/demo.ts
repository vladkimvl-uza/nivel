// WP-06: the demo layer: positions and price observations of block 28 with is_demo, market prices computed from them,
// showcase builds and two demo "ideas". Refuses to run when APP_MODE=production (ARCHITECTURE 3.1).
import type pg from "pg";
import { DEMO_PRODUCTS, DEMO_VENDORS } from "./demo-data.ts";
import { readAppMode, UnknownAppMode } from "./mode.ts";

export class DemoSeedRefused extends Error {
  constructor(reason: string) {
    super(`demo seed refused: ${reason}; demo data never goes to production`);
    this.name = "DemoSeedRefused";
  }
}

/** Throws in production, and for a mode that is not one of the three (an unset mode is development). */
export function assertDemoAllowed(env: Record<string, string | undefined> = process.env): void {
  try {
    if (readAppMode(env) === "production") throw new DemoSeedRefused("APP_MODE=production");
  } catch (e) {
    if (e instanceof UnknownAppMode) throw new DemoSeedRefused(e.message);
    throw e;
  }
}

/** Date of the prices of block 28 (table 1.2). */
export const DEMO_AS_OF = "2026-10-05";
const OBSERVED_AT = `${DEMO_AS_OF}T09:00:00Z`;

/** Six showcase builds of style A, each opens in the configurator (CONCEPT 5.1: six to nine of 32). */
export const SHOWCASE: readonly { task: string; tier: string }[] = [
  { task: "gaming", tier: "T2" },
  { task: "gaming", tier: "T3" },
  { task: "streaming", tier: "T2" },
  { task: "design3d", tier: "T2" },
  { task: "programming", tier: "T2" },
  { task: "office", tier: "T1" },
];

export interface DemoSeedResult {
  skipped: boolean;
  vendors: number;
  products: number;
  observations: number;
  marketPrices: number;
  showcase: number;
  ideas: number;
}

const EMPTY: DemoSeedResult = {
  skipped: false,
  vendors: 0,
  products: 0,
  observations: 0,
  marketPrices: 0,
  showcase: 0,
  ideas: 0,
};

/** Prices of one demo position at its vendors: the table price at vendor 1, +2 % and -2 % at the others. */
export function observationPrices(price: number, vendors: 1 | 2 | 3 = 3): number[] {
  return DEMO_VENDORS.slice(0, vendors).map((v) => Math.floor((price * (100 + v.percent)) / 100));
}

/** Median of three, the lowest of fewer, per ARCHITECTURE 4.5 (fewer than three vendors: no median). */
export function demoMarketPrice(prices: number[]) {
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const enough = n >= 3;
  return {
    median: enough ? (sorted[Math.floor(n / 2)] ?? null) : null,
    from: sorted[0] ?? null,
    min: sorted[0] ?? null,
    max: sorted[n - 1] ?? null,
    vendors: n,
    confidence: enough ? ("medium" as const) : ("low" as const),
  };
}

/** Idempotent in effect: a second run finds the demo positions and does nothing. Run inside the caller's transaction. */
export async function seedDemo(
  client: pg.Client,
  env: Record<string, string | undefined> = process.env,
): Promise<DemoSeedResult> {
  assertDemoAllowed(env);
  const present = await client.query("select 1 from catalog.products where is_demo limit 1");
  if (present.rowCount) return { ...EMPTY, skipped: true };

  const result = { ...EMPTY };
  const vendorIds: string[] = [];
  for (const v of DEMO_VENDORS) {
    const { rows } = await client.query<{ id: string }>(
      `insert into pricing.vendors (name, kind, price_source, public_name_allowed, status, is_demo)
       values ($1, $2, $3, false, 'active', true)
       on conflict (name) do update set is_demo = true returning id`,
      [v.name, v.kind, v.source === "partner_csv" ? "csv" : v.source === "partner_gsheet" ? "partner_sheet" : "manual"],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("vendor was not written");
    vendorIds.push(id);
  }
  result.vendors = vendorIds.length;

  // The CBU rate of block 28: dollars x 11 772,95.
  await client.query(
    `insert into pricing.fx_rates (ccy, rate, nominal, effective_date, source)
     values ('USD', '11772.95', 1, $1, 'manual') on conflict (ccy, effective_date) do nothing`,
    [DEMO_AS_OF],
  );

  for (const p of DEMO_PRODUCTS) {
    const cls = await client.query<{ id: string; step: number | null; manual_only: boolean }>(
      "select id, step, manual_only from catalog.price_classes where key = $1",
      [p.classKey],
    );
    const c = cls.rows[0];
    if (!c) throw new Error(`demo position ${p.slug} refers to the unknown price class ${p.classKey}`);
    const inserted = await client.query<{ id: string }>(
      `insert into catalog.products (slug, category_code, brand, model, price_class_id, ladder_step, color_body, lighting,
          power_peak_w, status, specs, dims_mm, manual_only, is_demo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'verified', $10, $11, $12, true) returning id`,
      [
        p.slug,
        p.category,
        p.brand,
        p.model,
        c.id,
        c.step,
        p.color,
        p.lighting,
        p.powerPeakW ?? null,
        JSON.stringify(p.specs),
        p.dimsMm ? JSON.stringify(p.dimsMm) : null,
        p.manualOnly ?? c.manual_only,
      ],
    );
    const productId = inserted.rows[0]?.id;
    if (!productId) throw new Error(`position ${p.slug} was not written`);
    result.products += 1;

    const prices = observationPrices(p.price, p.vendors ?? 3);
    const observationIds: string[] = [];
    for (const [i, price] of prices.entries()) {
      const vendorId = vendorIds[i];
      const vendor = DEMO_VENDORS[i];
      if (!vendorId || !vendor) continue;
      const offer = await client.query<{ id: string }>(
        `insert into pricing.offers (vendor_id, product_id, vendor_sku, raw_title, condition, match_status)
         values ($1, $2, $3, $4, 'new', 'manual') returning id`,
        [vendorId, productId, `DEMO-${p.slug}`, `${p.brand} ${p.model}`],
      );
      const obs = await client.query<{ id: string }>(
        `insert into pricing.price_observations (offer_id, product_id, vendor_id, price_sum, orig_amount, orig_currency,
            availability, condition, observed_at, source, entered_by, is_demo)
         values ($1, $2, $3, $4::bigint, $4::bigint::numeric, 'UZS', $5, 'new', $6, $7, 'seed', true) returning id`,
        [
          offer.rows[0]?.id,
          productId,
          vendorId,
          price,
          p.estimate ? "ask" : "in_stock",
          OBSERVED_AT,
          p.estimate ? "manual" : vendor.source === "partner_gsheet" ? "partner_gsheet" : vendor.source,
        ],
      );
      const obsId = obs.rows[0]?.id;
      if (obsId) observationIds.push(obsId);
      result.observations += 1;
    }

    const m = demoMarketPrice(prices);
    await client.query(
      `insert into pricing.market_prices (product_id, as_of, median_sum, from_sum, min_sum, max_sum, offers_n, vendors_n,
          max_age_days, confidence, flags, input_ids, computed_at, is_demo)
       values ($1, $2, $3, $4, $5, $6, $7, $7, 0, $8, '{}', $9, $10, true)`,
      [productId, DEMO_AS_OF, m.median, m.from, m.min, m.max, m.vendors, m.confidence, observationIds, OBSERVED_AT],
    );
    result.marketPrices += 1;
  }

  for (const s of SHOWCASE) {
    const r = await client.query(
      `update catalog.base_builds set is_showcase = true, is_demo = true
        where task = $1 and tier = $2 and style = 'A' and variant = 'base' and status = 'offered'`,
      [s.task, s.tier],
    );
    result.showcase += r.rowCount ?? 0;
  }

  const ideas = [
    {
      url: "https://www.instagram.com/p/DEMO-0001/",
      handle: "@demo.setup",
      tags: ["gaming", "white"],
      breakdown: [
        { uz: "Oq korpus", ru: "Белый корпус", classKey: "case.atx_senior_b" },
        { uz: "Videokarta", ru: "Видеокарта", classKey: "gpu.rtx5070" },
      ],
    },
    {
      url: "https://www.instagram.com/p/DEMO-0002/",
      handle: "@demo.workspace",
      tags: ["programming", "quiet"],
      breakdown: [
        { uz: "Protsessor", ru: "Процессор", classKey: "cpu.r7_9700x" },
        { uz: "Xotira", ru: "Память", classKey: "ram.ddr5_32" },
      ],
    },
  ];
  for (const idea of ideas) {
    const breakdown: unknown[] = [];
    for (const b of idea.breakdown) {
      const { rows } = await client.query<{ id: string }>("select id from catalog.price_classes where key = $1", [
        b.classKey,
      ]);
      breakdown.push({ label: { uz: b.uz, ru: b.ru }, priceClassId: rows[0]?.id ?? null });
    }
    await client.query(
      `insert into content.idea_posts (instagram_url, author_handle, permission_status, breakdown, tags, status, is_demo)
       values ($1, $2, 'none', $3, $4, 'published', true)`,
      [idea.url, idea.handle, JSON.stringify(breakdown), idea.tags],
    );
    result.ideas += 1;
  }
  return result;
}
