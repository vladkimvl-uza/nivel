import { specOf } from "../catalog/specs.ts";
import { bp } from "../money/index.ts";
import { firstOf, hasAny, type Item, itemsOf } from "./resolve.ts";
import type { CompatSettings, PowerEstimate, ResolvedBuild } from "./types.ts";

export interface MissingPowerInput {
  item: Item;
  field: string;
}

/** Fans on the radiator by size: 240 and 280 mm carry two, 360 and 420 mm carry three. */
const AIO_FANS: Record<number, number> = { 240: 2, 280: 2, 360: 3, 420: 3 };

/** Smallest series entry that covers `watts`; above the series, the next 100 W. Tolerates float noise (500 x 1.3). */
export function ceilToSeries(watts: number, series: readonly number[]): number {
  const need = Math.ceil(watts - 1e-9);
  const hit = [...series].sort((a, b) => a - b).find((w) => w >= need);
  return hit ?? Math.ceil(need / 100) * 100;
}

/**
 * Peak and recommended PSU (block 28, 3.4). `headroomBp` is the headroom of the selected PSU over the peak,
 * (rating - peak) / peak (ADR-007, item 7): the recommendation peak x 1.3 is a 30 % headroom, so a PSU of the
 * recommended wattage never triggers the headroom warning. Unknown (null) inputs count as 0, so the figures are a lower bound;
 * `missing` lists what was unknown and the PSU rule (it runs for any build with a processor or a card, PSU or not)
 * turns it into "incomplete". `estimatePower` has no place for the list: with unknown inputs its result is a lower bound.
 */
export function computePower(
  b: ResolvedBuild,
  s: CompatSettings,
): { estimate: PowerEstimate; missing: MissingPowerInput[] } {
  const missing: MissingPowerInput[] = [];
  let peak = 0;
  let fans = 0;
  let vendorMax = 0;

  const read = (value: number | null | undefined, item: Item, field: string) => {
    if (value === null || value === undefined) {
      missing.push({ item, field });
      return 0;
    }
    return value;
  };

  for (const item of itemsOf(b, "cpu")) {
    peak += read(specOf(item.product, "cpu")?.maxPowerW, item, "maxPowerW") * item.qty;
  }
  for (const item of itemsOf(b, "gpu")) {
    const spec = specOf(item.product, "gpu");
    peak += read(spec?.tgpW, item, "tgpW") * item.qty;
    vendorMax = Math.max(vendorMax, read(spec?.vendorRecommendedPsuW, item, "vendorRecommendedPsuW"));
  }
  for (const item of itemsOf(b, "case")) {
    fans += read(specOf(item.product, "case")?.fansIncluded, item, "fansIncluded");
  }
  for (const item of itemsOf(b, "fan")) {
    fans += read(specOf(item.product, "fan")?.count, item, "count") * item.qty;
  }
  for (const item of itemsOf(b, "aio")) {
    const rad = read(specOf(item.product, "aio")?.radMm, item, "radMm");
    fans += (AIO_FANS[rad] ?? 0) * item.qty;
    peak += s.pumpW * item.qty;
  }

  if (hasAny(b, "cpu", "mb", "ram", "ssd", "gpu")) peak += s.baseW;
  peak += fans * s.perFanW;

  const recommendedPsuW = peak > 0 ? Math.max(ceilToSeries(peak * s.psuMultiplier, s.psuSeriesW), vendorMax) : 0;
  const estimate: PowerEstimate = { peakW: peak, recommendedPsuW };

  const psu = firstOf(b, "psu");
  const psuWatts = psu ? specOf(psu.product, "psu")?.watts : undefined;
  if (psuWatts !== null && psuWatts !== undefined) {
    estimate.selectedPsuW = psuWatts;
    // Headroom is over the peak: (PSU - peak) / peak, floored to whole bp, clamped to the Bp range 0..10 000
    // (a PSU of twice the peak or more counts as 100 %). Without a peak there is nothing to compare: no figure.
    if (peak > 0)
      estimate.headroomBp = bp(Math.min(10_000, Math.floor((Math.max(0, psuWatts - peak) * 10_000) / peak)));
  }
  return { estimate, missing };
}
