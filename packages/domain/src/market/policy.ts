import type { CategoryCode } from "../catalog/types.ts";
import type { MarketPolicy } from "./types.ts";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * Default policy of "price by market" (block 08, 5.2-5.5; ARCHITECTURE 4.5). A test compares it with the document;
 * live values come from ops.settings, the freshness window per category from `marketPolicyFor`.
 */
export const DEFAULT_MARKET_POLICY: MarketPolicy = deepFreeze({
  freshnessDays: 7,
  minVendors: 3,
  smallSampleBand: [0.6, 1.6],
  madK: 3.5,
  currencyErrorRatio: 1000,
  high: { vendors: 5, maxAgeDays: 3 },
});

/**
 * Freshness window in days per category (block 08, 5.5): components and peripherals 7, graphics cards 3,
 * furniture, light and decor 30. Mirrors `categories.freshness_days` (ARCHITECTURE 3.3).
 */
export const FRESHNESS_DAYS_BY_CATEGORY: Readonly<Record<CategoryCode, 3 | 7 | 30>> = Object.freeze({
  cpu: 7,
  mb: 7,
  ram: 7,
  ssd: 7,
  gpu: 3,
  psu: 7,
  case: 7,
  cooler_air: 7,
  aio: 7,
  fan: 7,
  monitor: 7,
  arm: 7,
  desk: 30,
  desk_frame: 30,
  desk_top: 30,
  chair: 30,
  keyboard: 7,
  mouse: 7,
  mousepad: 7,
  headset: 7,
  microphone: 7,
  webcam: 7,
  light: 30,
  speakers: 7,
  acoustic_panel: 30,
  cable_mgmt: 30,
  ups: 7,
  decor: 30,
  os_license: 7,
});

/** Policy for one category: the base policy with the category's freshness window. */
export function marketPolicyFor(category: CategoryCode, base: MarketPolicy = DEFAULT_MARKET_POLICY): MarketPolicy {
  const freshnessDays = Object.hasOwn(FRESHNESS_DAYS_BY_CATEGORY, category)
    ? FRESHNESS_DAYS_BY_CATEGORY[category]
    : undefined;
  if (freshnessDays === undefined) throw new RangeError(`Unknown category: ${String(category)}`);
  return { ...base, smallSampleBand: [...base.smallSampleBand], high: { ...base.high }, freshnessDays };
}

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Throws RangeError for a policy that cannot be applied (a settings bug must fail loudly, not skew prices). */
export function assertMarketPolicy(p: MarketPolicy): void {
  const bad = (what: string): never => {
    throw new RangeError(`Invalid market policy: ${what}`);
  };
  if (!positive(p.freshnessDays)) bad("freshnessDays must be positive");
  if (!Number.isInteger(p.minVendors) || p.minVendors < 1) bad("minVendors must be an integer >= 1");
  const [lo, hi] = p.smallSampleBand;
  if (!positive(lo) || !positive(hi) || lo >= hi) bad("smallSampleBand must be 0 < low < high");
  if (!positive(p.madK)) bad("madK must be positive");
  if (!Number.isFinite(p.currencyErrorRatio) || p.currencyErrorRatio < 1) bad("currencyErrorRatio must be >= 1");
  if (!Number.isInteger(p.high.vendors) || p.high.vendors < 1) bad("high.vendors must be an integer >= 1");
  if (!Number.isFinite(p.high.maxAgeDays) || p.high.maxAgeDays < 0) bad("high.maxAgeDays must be >= 0");
}
