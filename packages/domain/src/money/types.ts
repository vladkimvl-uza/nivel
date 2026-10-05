// Frozen contract (ARCHITECTURE 4.2). Change only via ADR and a "contract" PR.

/** Whole Uzbek sums. Integer only, never floats, never tiyin. */
export type Sum = number & { readonly __brand: "Sum" };
/** Basis points: 1500 = 15 %. */
export type Bp = number & { readonly __brand: "Bp" };
export type Locale = "uz" | "ru";
export type Localized = Record<Locale, string>;
export type IsoDate = string; // "2026-10-05"
export type Rounding = "floor" | "half_up" | "ceil";

export interface MoneyApi {
  /** Throws RangeError unless Number.isSafeInteger. */
  sum(n: number): Sum;
  /** Integer 0..10_000. */
  bp(n: number): Bp;
  /** base × rate / 10 000 with explicit rounding to a whole sum. */
  applyBp(base: Sum, rate: Bp, mode: Rounding): Sum;
  /** Rounds to a step (1 000, 10 000) — display and reserve only, never receipts or fee. */
  roundTo(value: Sum, step: number, mode: Rounding): Sum;
  /** Splits total by shares (Σ shares = 10 000) with largest-remainder rounding: parts always add up to total. */
  splitByShares(total: Sum, shares: readonly Bp[]): Sum[];
  addSums(...xs: Sum[]): Sum;
}
