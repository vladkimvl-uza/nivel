// Repositories of the pricing schema: vendors, offers, observations, market prices, rates (ARCHITECTURE 3.3, 4.5).
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { fxRates, marketPrices, offers, priceObservations, skuMappings, vendors } from "../schema/pricing.ts";
import { expectUpdated, guarded } from "./errors.ts";
import type { Executor } from "./executor.ts";

export type VendorInsert = Omit<typeof vendors.$inferInsert, "id" | "createdAt">;
export type ObservationInsert = Omit<typeof priceObservations.$inferInsert, "id" | "excluded" | "excludeReason">;
export type ObservationRow = typeof priceObservations.$inferSelect;
export type MarketPriceInsert = Omit<typeof marketPrices.$inferInsert, "id" | "computedAt">;

export async function createVendor(db: Executor, v: VendorInsert): Promise<string> {
  const [row] = await guarded(() => db.insert(vendors).values(v).returning({ id: vendors.id }));
  if (!row) throw new Error("vendor was not written");
  return row.id;
}

export async function getVendorByName(db: Executor, name: string) {
  const [row] = await db.select().from(vendors).where(eq(vendors.name, name));
  return row ?? null;
}

export async function listActiveVendors(db: Executor) {
  return db.select().from(vendors).where(eq(vendors.status, "active")).orderBy(asc(vendors.name));
}

// ---- rates ------------------------------------------------------------------------------------------------------
export interface FxInput {
  ccy: "USD" | "EUR" | "RUB";
  /** Decimal string as published by the CBU ("11772.95"); never parsed through a float. */
  rate: string;
  nominal?: number;
  effectiveDate: string;
  source: "cbu_json" | "cbu_xml" | "manual";
  diff?: string;
}

/** One rate per currency and day: a repeated fetch of the same day updates the row. */
export async function upsertFxRate(db: Executor, r: FxInput): Promise<string> {
  const [row] = await guarded(() =>
    db
      .insert(fxRates)
      .values({
        ccy: r.ccy,
        rate: r.rate,
        nominal: r.nominal ?? 1,
        effectiveDate: r.effectiveDate,
        source: r.source,
        diff: r.diff ?? null,
      })
      .onConflictDoUpdate({
        target: [fxRates.ccy, fxRates.effectiveDate],
        set: { rate: r.rate, nominal: r.nominal ?? 1, source: r.source, diff: r.diff ?? null, fetchedAt: sql`now()` },
      })
      .returning({ id: fxRates.id }),
  );
  if (!row) throw new Error("rate was not written");
  return row.id;
}

/** The newest rate of a currency not later than `asOf` (a day without a CBU rate uses the previous one). */
export async function latestFxRate(db: Executor, ccy: "USD" | "EUR" | "RUB", asOf?: string) {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.ccy, ccy), asOf ? sql`${fxRates.effectiveDate} <= ${asOf}::date` : undefined))
    .orderBy(desc(fxRates.effectiveDate))
    .limit(1);
  return row ?? null;
}

// ---- offers and observations --------------------------------------------------------------------------------------
export async function upsertOffer(
  db: Executor,
  o: {
    vendorId: string;
    vendorSku: string;
    rawTitle: string;
    productId?: string;
    url?: string;
    mpn?: string;
    ean?: string;
  },
): Promise<string> {
  const [row] = await guarded(() =>
    db
      .insert(offers)
      .values({
        vendorId: o.vendorId,
        vendorSku: o.vendorSku,
        rawTitle: o.rawTitle,
        productId: o.productId ?? null,
        url: o.url ?? null,
        mpn: o.mpn ?? null,
        ean: o.ean ?? null,
        matchStatus: o.productId ? "auto" : "unmatched",
      })
      .onConflictDoUpdate({
        target: [offers.vendorId, offers.vendorSku],
        set: { rawTitle: o.rawTitle, url: o.url ?? null, active: true },
      })
      .returning({ id: offers.id }),
  );
  if (!row) throw new Error("offer was not written");
  return row.id;
}

/** Memory of the match "price line -> position": a repeated import does not ask the human again. */
export async function saveSkuMapping(
  db: Executor,
  m: { vendorId: string; vendorSku: string; rawTitleNormalized: string; productId: string; confirmedBy?: string },
): Promise<void> {
  await guarded(() =>
    db
      .insert(skuMappings)
      .values({ ...m, confirmedBy: m.confirmedBy ?? null, confirmedAt: new Date() })
      .onConflictDoUpdate({
        target: [skuMappings.vendorId, skuMappings.vendorSku],
        set: {
          productId: m.productId,
          rawTitleNormalized: m.rawTitleNormalized,
          confirmedBy: m.confirmedBy ?? null,
          confirmedAt: new Date(),
        },
      }),
  );
}

export async function findSkuMapping(db: Executor, vendorId: string, vendorSku: string) {
  const [row] = await db
    .select()
    .from(skuMappings)
    .where(and(eq(skuMappings.vendorId, vendorId), eq(skuMappings.vendorSku, vendorSku)));
  return row ?? null;
}

/** Appends an observation; the journal is append-only, only the exclusion flag changes later. */
export async function insertObservation(db: Executor, o: ObservationInsert): Promise<string> {
  const [row] = await guarded(() => db.insert(priceObservations).values(o).returning({ id: priceObservations.id }));
  if (!row) throw new Error("observation was not written");
  return row.id;
}

export async function excludeObservation(
  db: Executor,
  id: string,
  reason: NonNullable<ObservationRow["excludeReason"]>,
): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(priceObservations)
      .set({ excluded: true, excludeReason: reason })
      .where(eq(priceObservations.id, id))
      .returning({ id: priceObservations.id }),
  );
  expectUpdated(rows, "observation", id);
}

export async function restoreObservation(db: Executor, id: string): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(priceObservations)
      .set({ excluded: false, excludeReason: null })
      .where(eq(priceObservations.id, id))
      .returning({ id: priceObservations.id }),
  );
  expectUpdated(rows, "observation", id);
}

/** Observations of a position, newest first, since a moment; excluded ones only on request. */
export async function listObservations(
  db: Executor,
  productId: string,
  o: { since?: Date; includeExcluded?: boolean; limit?: number } = {},
): Promise<ObservationRow[]> {
  return db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        o.since ? gte(priceObservations.observedAt, o.since) : undefined,
        o.includeExcluded ? undefined : eq(priceObservations.excluded, false),
      ),
    )
    .orderBy(desc(priceObservations.observedAt), desc(priceObservations.id))
    .limit(o.limit ?? 500);
}

// ---- market prices ------------------------------------------------------------------------------------------------
/** One computed price per position and day; a recomputation of the same day replaces the row. */
export async function upsertMarketPrice(db: Executor, m: MarketPriceInsert): Promise<void> {
  await guarded(() =>
    db
      .insert(marketPrices)
      .values(m)
      .onConflictDoUpdate({
        target: [marketPrices.productId, marketPrices.asOf],
        set: {
          medianSum: m.medianSum ?? null,
          fromSum: m.fromSum ?? null,
          minSum: m.minSum ?? null,
          maxSum: m.maxSum ?? null,
          offersN: m.offersN ?? 0,
          vendorsN: m.vendorsN ?? 0,
          maxAgeDays: m.maxAgeDays ?? null,
          confidence: m.confidence,
          flags: m.flags ?? [],
          inputIds: m.inputIds ?? [],
          computedAt: sql`now()`,
        },
      }),
  );
}

export interface CurrentPrice {
  productId: string;
  asOf: string;
  medianSum: number | null;
  fromSum: number | null;
  vendorsN: number;
  confidence: "high" | "medium" | "low";
  isDemo: boolean;
}

/** Latest market price of every position (view pricing.v_market_price_current), optionally of some only. */
export async function currentMarketPrices(db: Executor, productIds?: string[]): Promise<CurrentPrice[]> {
  const { rows } = await db.execute<{
    product_id: string;
    as_of: string;
    median_sum: string | null;
    from_sum: string | null;
    vendors_n: number;
    confidence: "high" | "medium" | "low";
    is_demo: boolean;
  }>(
    productIds && productIds.length > 0
      ? sql`select product_id, as_of::text, median_sum::text, from_sum::text, vendors_n, confidence, is_demo
              from pricing.v_market_price_current
             where product_id in (${sql.join(
               productIds.map((id) => sql`${id}::uuid`),
               sql`, `,
             )})`
      : sql`select product_id, as_of::text, median_sum::text, from_sum::text, vendors_n, confidence, is_demo
              from pricing.v_market_price_current`,
  );
  return rows.map((r) => ({
    productId: r.product_id,
    asOf: r.as_of,
    medianSum: r.median_sum === null ? null : Number(r.median_sum),
    fromSum: r.from_sum === null ? null : Number(r.from_sum),
    vendorsN: r.vendors_n,
    confidence: r.confidence,
    isDemo: r.is_demo,
  }));
}
