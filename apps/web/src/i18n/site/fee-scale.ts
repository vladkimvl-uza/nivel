// The price list of the one-page site: the scale of the fee, the minimum estimates, the shares of the stages, the date
// from which they apply. The numbers are read from the setting `money.fee_settings` of the owner (the same one the
// estimate of an order is computed with, DECISIONS R-8, R-26); only what the page shows is taken, and a setting that is
// broken is not guessed at: the page falls back to the defaults of 05.10.2026.
//
// The fee here is the same rule the domain applies (`computeFee` of @nivel/domain/fee, ARCHITECTURE 4.6), written for
// display: the site shows the scale and examples, it never prices an order. When `@nivel/domain` becomes a dependency of
// apps/web this file should call `computeFee` instead (request to the integrator in the report of WP-16).

export interface FeeScale {
  version: string;
  /** The date the price list applies from, `yyyy-mm-dd` (GK art. 662: the list is published with a date). */
  effectiveFrom: string;
  pcLowRateBp: number;
  pcHighRateBp: number;
  pcThreshold: number;
  pcHighMinFee: number;
  mountRateBp: number;
  minFullCyclePc: number;
  minFreeWindowPc: number;
  minFullCycleSetup: number;
  advanceBp: number;
  reserveBp: number;
  /** The reserve is higher when memory and SSD make up this share (basis points) of the purchased parts. */
  reserveHighBp: number;
  reserveHighShareBp: number;
  /** The reserve is rounded up to this step, sums. */
  reserveRoundStep: number;
  stageSharesBp: { selection: number; purchase: number; assembly: number; handover: number };
  /** How long an estimate of components stays valid, hours. */
  shelfComponentsHours: number;
}

/** The rules accepted by the owner on 05.10.2026 (the same values as DEFAULT_FEE_SETTINGS of the domain). */
export const DEFAULT_FEE_SCALE: Readonly<FeeScale> = Object.freeze({
  version: "2026-10-05",
  effectiveFrom: "2026-10-05",
  pcLowRateBp: 1500,
  pcHighRateBp: 1000,
  pcThreshold: 20_000_000,
  pcHighMinFee: 3_000_000,
  mountRateBp: 1500,
  minFullCyclePc: 6_700_000,
  minFreeWindowPc: 4_500_000,
  minFullCycleSetup: 13_300_000,
  advanceBp: 3000,
  reserveBp: 300,
  reserveHighBp: 500,
  reserveHighShareBp: 2500,
  reserveRoundStep: 10_000,
  stageSharesBp: Object.freeze({ selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 }),
  shelfComponentsHours: 24,
});

const BP_SCALE = 10_000n;

function assertSum(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a whole non-negative number of sums`);
}

/** floor(base × bp / 10 000) without a floating point; BigInt keeps every digit. */
function applyBpFloor(base: number, bp: number): number {
  assertSum(base, "base");
  return Number((BigInt(base) * BigInt(bp)) / BP_SCALE);
}

/** The fee on a PC estimate: below the threshold the low rate, from it the high rate but not less than the minimum. */
export function pcFee(base: number, s: Readonly<FeeScale>): number {
  assertSum(base, "base");
  if (base < s.pcThreshold) return applyBpFloor(base, s.pcLowRateBp);
  return Math.max(applyBpFloor(base, s.pcHighRateBp), s.pcHighMinFee);
}

/** The fee on the mounting of the workplace. */
export function mountFee(base: number, s: Readonly<FeeScale>): number {
  return applyBpFloor(base, s.mountRateBp);
}

/** The estimate up to which the minimum fee still applies (the high rate catches up with it): 30 million by default. */
export function noJumpUpTo(s: Readonly<FeeScale>): number {
  return Number((BigInt(s.pcHighMinFee) * BP_SCALE) / BigInt(s.pcHighRateBp));
}

/** The reserve of the purchase limit: ceil(parts × rate), rounded up to the step; the rate depends on the share of memory and SSD. */
export function purchaseReserve(
  partsTotal: number,
  memoryTotal: number,
  s: Readonly<FeeScale>,
): { rateBp: number; reserve: number } {
  assertSum(partsTotal, "partsTotal");
  assertSum(memoryTotal, "memoryTotal");
  const high = partsTotal > 0 && BigInt(memoryTotal) * BP_SCALE >= BigInt(s.reserveHighShareBp) * BigInt(partsTotal);
  const rateBp = high ? s.reserveHighBp : s.reserveBp;
  const exact = BigInt(partsTotal) * BigInt(rateBp);
  const ceil = (exact + BP_SCALE - 1n) / BP_SCALE;
  const step = BigInt(s.reserveRoundStep);
  return { rateBp, reserve: Number(((ceil + step - 1n) / step) * step) };
}

/** "3–5 %": the low and the high reserve rate as one range. */
export function reserveRange(s: Readonly<FeeScale>): string {
  const bare = (bp: number) => salePercent(bp).replace(" %", "");
  return `${bare(s.reserveBp)}–${bare(s.reserveHighBp)} %`;
}

/** "15 %", "12,5 %", "0,05 %": basis points as a percent, a comma for the fraction, a non-breaking space before the sign. */
export function salePercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = String(bp % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${rest === "" ? whole : `${whole},${rest}`} %`;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const whole = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null;

function isCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** The part of `money.fee_settings` the page shows, or null when the setting is not what the domain would accept. */
export function parseFeeScale(value: unknown): FeeScale | null {
  const raw = record(value);
  const shares = record(raw?.stageSharesBp);
  const shelf = record(raw?.shelfLifeHours);
  if (!raw || !shares || !shelf) return null;
  const version = raw.version;
  const effectiveFrom = raw.effectiveFrom;
  if (typeof version !== "string" || version.trim() === "") return null;
  if (typeof effectiveFrom !== "string" || !isCalendarDate(effectiveFrom)) return null;
  const n = {
    pcLowRateBp: whole(raw.pcLowRateBp, 10_000),
    pcHighRateBp: whole(raw.pcHighRateBp, 10_000),
    pcThreshold: whole(raw.pcThreshold),
    pcHighMinFee: whole(raw.pcHighMinFee),
    mountRateBp: whole(raw.mountRateBp, 10_000),
    minFullCyclePc: whole(raw.minFullCyclePc),
    minFreeWindowPc: whole(raw.minFreeWindowPc),
    minFullCycleSetup: whole(raw.minFullCycleSetup),
    advanceBp: whole(raw.advanceBp, 10_000),
    reserveBp: whole(raw.reserveBp, 10_000),
    reserveHighBp: whole(raw.reserveHighBp, 10_000),
    reserveHighShareBp: whole(raw.reserveHighShareBp, 10_000),
    reserveRoundStep: whole(raw.reserveRoundStep),
    selection: whole(shares.selection, 10_000),
    purchase: whole(shares.purchase, 10_000),
    assembly: whole(shares.assembly, 10_000),
    handover: whole(shares.handover, 10_000),
    shelfComponentsHours: whole(shelf.components),
  };
  for (const v of Object.values(n)) if (v === null) return null;
  const k = n as { [K in keyof typeof n]: number };
  if (k.pcHighRateBp === 0 || k.reserveRoundStep === 0) return null; // divisors of the displayed numbers
  if (k.selection + k.purchase + k.assembly + k.handover !== 10_000) return null;
  return {
    version,
    effectiveFrom,
    pcLowRateBp: k.pcLowRateBp,
    pcHighRateBp: k.pcHighRateBp,
    pcThreshold: k.pcThreshold,
    pcHighMinFee: k.pcHighMinFee,
    mountRateBp: k.mountRateBp,
    minFullCyclePc: k.minFullCyclePc,
    minFreeWindowPc: k.minFreeWindowPc,
    minFullCycleSetup: k.minFullCycleSetup,
    advanceBp: k.advanceBp,
    reserveBp: k.reserveBp,
    reserveHighBp: k.reserveHighBp,
    reserveHighShareBp: k.reserveHighShareBp,
    reserveRoundStep: k.reserveRoundStep,
    stageSharesBp: { selection: k.selection, purchase: k.purchase, assembly: k.assembly, handover: k.handover },
    shelfComponentsHours: k.shelfComponentsHours,
  };
}

export interface ChartPoint {
  base: number;
  fee: number;
}

/** The curve of the fee chart: estimates from 5 to 60 million in steps of 250 000 sums. */
export function feeChartPoints(s: Readonly<FeeScale>): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (let base = 5_000_000; base <= 60_000_000; base += 250_000) out.push({ base, fee: pcFee(base, s) });
  return out;
}
