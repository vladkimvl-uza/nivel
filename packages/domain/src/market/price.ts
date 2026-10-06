import { type Sum, sum } from "../money/index.ts";
import { assertMarketPolicy } from "./policy.ts";
import type { ExcludeReason, MarketPolicy, MarketPrice, PriceObservation } from "./types.ts";

const DAY_MS = 86_400_000;
/** Samples of 3-5 vendors use the fixed band, from 6 the MAD rule (block 08, 5.3). */
const SMALL_SAMPLE_MAX = 5;
/** Scale that makes MAD comparable to a standard deviation (block 08, 5.3). */
const MAD_SCALE = 1.4826;
/** Prices closer than this (hundreds of sums) count as one level of a single dealer (block 08, 5.4). */
const SAME_PRICE_SPAN = 1_000;

type Flag = MarketPrice["flags"][number];

interface Candidate {
  obs: PriceObservation;
  price: number;
  /** Age at `now` in ms; a timestamp from the future counts as 0. */
  ageMs: number;
}

/** Median of an ascending non-empty list; an even count gives the mean of the middle pair rounded up. */
function medianCeil(ascending: readonly number[]): number {
  const n = ascending.length;
  const mid = n >> 1;
  const upper = ascending[mid] as number;
  if (n % 2 === 1) return upper;
  const lower = ascending[mid - 1] as number;
  return lower + Math.floor((upper - lower + 1) / 2); // ceil((lower + upper) / 2) without overflowing the sum
}

const ascending = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** First applicable reason of block 08, 5.2: new and in stock, no "from" price or private seller, fresh. */
function eligibilityReason(c: Candidate, policy: MarketPolicy): ExcludeReason | null {
  const o = c.obs;
  if (o.condition !== "new") return "used_or_refurb";
  if (o.availability !== "in_stock") return "not_in_stock";
  if (o.isFromPrice) return "from_price";
  if (o.vendorKind === "private") return "private_seller";
  if (c.ageMs > policy.freshnessDays * DAY_MS) return "stale";
  return null;
}

/** Lower price wins; equal prices - the fresher observation, then the smaller id (independent of input order). */
function isBetter(a: Candidate, b: Candidate): boolean {
  if (a.price !== b.price) return a.price < b.price;
  if (a.obs.observedAt.getTime() !== b.obs.observedAt.getTime()) {
    return a.obs.observedAt.getTime() > b.obs.observedAt.getTime();
  }
  return a.obs.id < b.obs.id;
}

function validate(o: PriceObservation, productId: string): void {
  if (o.productId !== productId) {
    throw new RangeError(`Observation ${o.id} belongs to ${o.productId}, expected ${productId}`);
  }
  if (!Number.isSafeInteger(o.priceSum) || o.priceSum <= 0) {
    throw new RangeError(`Observation ${o.id}: price must be a positive whole sum, got ${String(o.priceSum)}`);
  }
  if (!(o.observedAt instanceof Date) || !Number.isFinite(o.observedAt.getTime())) {
    throw new RangeError(`Observation ${o.id}: invalid observation time`);
  }
}

/** Number of price levels: prices within SAME_PRICE_SPAN of a level's lowest price belong to that level. */
function countPriceLevels(ascendingPrices: readonly number[]): number {
  let levels = 0;
  let anchor = Number.NEGATIVE_INFINITY;
  for (const p of ascendingPrices) {
    if (p - anchor >= SAME_PRICE_SPAN) {
      levels++;
      anchor = p;
    }
  }
  return levels;
}

/** Prices outside the sample's own spread (block 08, 5.3). Needs at least `minVendors` prices. */
function findOutliers(pool: readonly Candidate[], policy: MarketPolicy): Set<Candidate> {
  const prices = ascending(pool.map((c) => c.price));
  const median = medianCeil(prices);
  const [lo, hi] = policy.smallSampleBand;
  const outsideBand = (c: Candidate): boolean => c.price < lo * median || c.price > hi * median;

  if (pool.length <= SMALL_SAMPLE_MAX) return new Set(pool.filter(outsideBand));

  const mad = medianCeil(ascending(prices.map((p) => Math.abs(p - median))));
  // Identical prices make MAD zero: any deviation would be an "outlier". Fall back to the band then.
  if (mad === 0) return new Set(pool.filter(outsideBand));
  const limit = policy.madK * MAD_SCALE * mad;
  return new Set(pool.filter((c) => Math.abs(c.price - median) > limit));
}

/**
 * Price by market (block 08, 5.2-5.4; ARCHITECTURE 4.5). Pure and independent of the order of `obs`.
 * Steps: new and in stock -> no "from" price or private sellers -> fresh -> one (lowest) price per vendor
 * -> currency error -> outliers -> median, "from", range -> confidence.
 * `offers` and `vendors` both count what remains after all filters (one price per vendor makes them equal).
 */
export function computeMarketPrice(obs: readonly PriceObservation[], now: Date, policy: MarketPolicy): MarketPrice {
  assertMarketPolicy(policy);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date");
  const first = obs[0];
  if (first === undefined) throw new RangeError("computeMarketPrice needs at least one observation");

  const excluded: { observationId: string; reason: ExcludeReason }[] = [];
  const exclude = (c: Candidate, reason: ExcludeReason): void => {
    excluded.push({ observationId: c.obs.id, reason });
  };

  // 1. Eligibility filters.
  const eligible: Candidate[] = [];
  for (const o of obs) {
    validate(o, first.productId);
    const c: Candidate = { obs: o, price: o.priceSum, ageMs: Math.max(0, nowMs - o.observedAt.getTime()) };
    const reason = eligibilityReason(c, policy);
    if (reason === null) eligible.push(c);
    else exclude(c, reason);
  }

  // 2. One price per vendor: the lowest.
  const perVendor = new Map<string, Candidate>();
  for (const c of eligible) {
    const kept = perVendor.get(c.obs.vendorId);
    if (kept === undefined) perVendor.set(c.obs.vendorId, c);
    else if (isBetter(c, kept)) {
      exclude(kept, "duplicate_vendor");
      perVendor.set(c.obs.vendorId, c);
    } else exclude(c, "duplicate_vendor");
  }
  let pool = [...perVendor.values()].sort((a, b) => a.price - b.price || compareText(a.obs.id, b.obs.id));

  // 3. Currency error: a price a thousand times below the median is dollars typed into the sum field.
  const flags = new Set<Flag>();
  if (pool.length > 0) {
    const median = medianCeil(pool.map((c) => c.price));
    const kept: Candidate[] = [];
    for (const c of pool) {
      if (c.price * policy.currencyErrorRatio < median) {
        exclude(c, "currency_error");
        flags.add("currency_suspect");
      } else kept.push(c);
    }
    pool = kept;
  }

  // 4. Outliers; a sample below minVendors is too small to judge.
  if (pool.length >= policy.minVendors) {
    const outliers = findOutliers(pool, policy);
    for (const c of outliers) {
      exclude(c, "outlier");
      flags.add("outlier_removed");
    }
    pool = pool.filter((c) => !outliers.has(c));
  }

  // 5. Result.
  const prices = pool.map((c) => c.price); // ascending: the pool is sorted by price
  const vendors = pool.length;
  const median = vendors >= policy.minVendors ? sum(medianCeil(prices)) : null;
  const maxAgeMs = pool.reduce((m, c) => Math.max(m, c.ageMs), 0);
  const priceOrNull = (i: number | undefined): Sum | null => (i === undefined ? null : sum(prices[i] as number));

  if (median !== null && countPriceLevels(prices) < policy.minVendors) flags.add("same_price_cluster");

  let confidence: MarketPrice["confidence"] = "low";
  if (median !== null) {
    // Data older than the window never gets here, so the "4-7 days" band of medium is the rest of the window.
    confidence = vendors >= policy.high.vendors && maxAgeMs <= policy.high.maxAgeDays * DAY_MS ? "high" : "medium";
  }

  const flagOrder: readonly Flag[] = ["outlier_removed", "currency_suspect", "same_price_cluster"];
  return {
    productId: first.productId,
    asOf: new Date(nowMs),
    median,
    from: priceOrNull(vendors > 0 ? 0 : undefined),
    min: priceOrNull(vendors > 0 ? 0 : undefined),
    max: priceOrNull(vendors > 0 ? vendors - 1 : undefined),
    offers: vendors,
    vendors,
    maxAgeDays: Math.ceil(maxAgeMs / DAY_MS),
    confidence,
    flags: flagOrder.filter((f) => flags.has(f)),
    excluded: excluded.sort((a, b) => compareText(a.observationId, b.observationId) || compareText(a.reason, b.reason)),
  };
}
