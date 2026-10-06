import type { Bp, MoneyApi, Rounding, Sum } from "./types.ts";

export * from "./payment.ts";
export type * from "./types.ts";

const BP_SCALE = 10_000n;

/** Branded whole sum. Throws RangeError unless `n` is a safe integer. */
export function sum(n: number): Sum {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new RangeError(`Sum must be a safe integer, got ${String(n)}`);
  }
  return (n + 0) as Sum; // `+ 0` turns -0 into 0
}

/** Branded basis points: integer 0..10 000. */
export function bp(n: number): Bp {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10_000) {
    throw new RangeError(`Bp must be an integer 0..10000, got ${String(n)}`);
  }
  return (n + 0) as Bp;
}

function checkMode(mode: Rounding): void {
  if (mode !== "floor" && mode !== "half_up" && mode !== "ceil") {
    throw new RangeError(`Unknown rounding mode: ${String(mode)}`);
  }
}

/** Integer division of BigInts rounding towards minus infinity (denominator > 0). */
function floorDiv(a: bigint, d: bigint): bigint {
  const q = a / d;
  return a % d !== 0n && a < 0n ? q - 1n : q;
}

/** a / d to an integer with the given mode; ties in half_up go towards plus infinity (denominator > 0). */
function divRound(a: bigint, d: bigint, mode: Rounding): bigint {
  if (mode === "floor") return floorDiv(a, d);
  if (mode === "ceil") return -floorDiv(-a, d);
  return floorDiv(2n * a + d, 2n * d);
}

/** base × rate / 10 000, rounded to a whole sum. BigInt inside: no precision loss for any safe base. */
export function applyBp(base: Sum, rate: Bp, mode: Rounding): Sum {
  checkMode(mode);
  const b = sum(base);
  const r = bp(rate);
  return sum(Number(divRound(BigInt(b) * BigInt(r), BP_SCALE, mode)));
}

/** Rounds to a multiple of `step`: display and reserve only, never receipts or fee. */
export function roundTo(value: Sum, step: number, mode: Rounding): Sum {
  checkMode(mode);
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw new RangeError(`Step must be a positive safe integer, got ${String(step)}`);
  }
  const s = BigInt(step);
  return sum(Number(divRound(BigInt(sum(value)), s, mode) * s));
}

/** Largest-remainder split: parts always add up to `total`; ties go to the lower index. */
export function splitByShares(total: Sum, shares: readonly Bp[]): Sum[] {
  const t = BigInt(sum(total));
  if (shares.length === 0) throw new RangeError("shares must not be empty");
  const weights = shares.map((s) => BigInt(bp(s)));
  if (weights.reduce((a, b) => a + b, 0n) !== BP_SCALE) {
    throw new RangeError("shares must add up to 10 000 bp");
  }
  const parts = weights.map((w) => floorDiv(t * w, BP_SCALE));
  const remainders = weights.map((w, i) => t * w - (parts[i] as bigint) * BP_SCALE);
  let left = Number(t - parts.reduce((a, b) => a + b, 0n)); // 0 <= left < shares.length
  const order = remainders
    .map((rem, i) => ({ rem, i }))
    .sort((x, y) => (x.rem === y.rem ? x.i - y.i : x.rem > y.rem ? -1 : 1));
  for (const { i } of order) {
    if (left === 0) break;
    parts[i] = (parts[i] as bigint) + 1n;
    left--;
  }
  return parts.map((p) => sum(Number(p)));
}

export function addSums(...xs: Sum[]): Sum {
  let acc = 0;
  for (const x of xs) acc = sum(acc + sum(x));
  return sum(acc);
}

/** Compile-time check: the implementation matches the frozen contract. */
export const moneyApi = { sum, bp, applyBp, roundTo, splitByShares, addSums } satisfies MoneyApi;
