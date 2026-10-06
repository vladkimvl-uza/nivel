import { type Bp, bp, type IsoDate, type Sum, sum } from "../money/index.ts";
import type { DealEntry, ThresholdApi, ThresholdSettings, ThresholdStatus } from "./types.ts";

export type * from "./types.ts";

/** Default threshold: 1 bn sum a year (NK art. 461, 462 part 9), lower-bound proportion, alerts at 60 to 100 % (ARCHITECTURE 4.8). */
export const DEFAULT_THRESHOLD_SETTINGS: ThresholdSettings = Object.freeze({
  annualLimit: sum(1_000_000_000),
  alertsBp: Object.freeze([bp(6000), bp(7000), bp(8000), bp(9000), bp(10_000)]) as Bp[],
  proportion: "without_registration_day",
});

const DAY_MS = 86_400_000;

interface Ymd {
  year: number;
  month: number;
  day: number;
}

/** Strict "YYYY-MM-DD": rejects other formats and non-existent dates. */
function parseIsoDate(date: IsoDate): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const year = Number(m?.[1]);
  const month = Number(m?.[2]);
  const day = Number(m?.[3]);
  const t = new Date(Date.UTC(year, month - 1, day));
  if (!m || t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) {
    throw new RangeError(`Invalid ISO date: ${JSON.stringify(date)}`);
  }
  return { year, month, day };
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Registration year: floor(annualLimit × days / daysInYear), exact integer arithmetic; other years: the full limit. */
export function thresholdForYear(year: number, s: ThresholdSettings): Sum {
  if (!Number.isInteger(year)) throw new RangeError(`Year must be an integer, got ${String(year)}`);
  const limit = sum(s.annualLimit);
  if (s.registrationDate === undefined) return limit;
  const reg = parseIsoDate(s.registrationDate);
  if (reg.year !== year) return limit;
  const daysInYear = isLeap(year) ? 366 : 365;
  const dayOfYear = (Date.UTC(year, reg.month - 1, reg.day) - Date.UTC(year, 0, 1)) / DAY_MS + 1;
  const days = daysInYear - dayOfYear + (s.proportion === "with_registration_day" ? 1 : 0);
  return sum(Number((BigInt(limit) * BigInt(days)) / BigInt(daysInYear)));
}

/** Signed contribution of an entry to the yearly volume (NK art. 462 part 9): refunds of the fee are subtracted. */
function signedAmount(e: DealEntry): number {
  switch (e.kind) {
    case "receipt":
    case "fee_in":
    case "other_income":
      return sum(e.amount);
    case "fee_refund":
      return -sum(e.amount);
    default:
      throw new RangeError(`Unknown deal entry kind: ${String((e as { kind: unknown }).kind)}`);
  }
}

/** floor(part × 10 000 / whole) clamped to 0..10 000; a zero whole is exhausted by any positive part. */
function shareOf(part: number, whole: Sum): Bp {
  if (part <= 0) return bp(0);
  if (whole <= 0) return bp(10_000);
  return bp(Math.min(10_000, Number((BigInt(part) * 10_000n) / BigInt(whole))));
}

export function thresholdStatus(
  entries: readonly DealEntry[],
  committed: Sum,
  year: number,
  s: ThresholdSettings,
): ThresholdStatus {
  const limit = thresholdForYear(year, s);
  const committedSum = sum(committed);
  let volume = 0;
  for (const e of entries) {
    const amount = signedAmount(e);
    if (parseIsoDate(e.date).year === year) volume = sum(volume + amount);
  }
  const shareBp = shareOf(volume, limit);
  const projected = volume + committedSum;
  const alerts = [...new Set(s.alertsBp)].sort((a, b) => a - b);
  return {
    year,
    limit,
    volume: sum(volume),
    committed: committedSum,
    shareBp,
    projectedShareBp: shareOf(projected, limit),
    crossedAlerts: alerts.filter((a) => shareBp >= a),
    overPlanCap: s.planCap !== undefined && projected > s.planCap,
    remaining: sum(Math.max(0, limit - projected)),
  };
}

export const thresholdApi = { thresholdForYear, thresholdStatus } satisfies ThresholdApi;
