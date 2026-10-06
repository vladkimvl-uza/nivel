import { type Sum, sum } from "../money/index.ts";
import type { FxRate } from "./types.ts";

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
/** Guards BigInt powers against absurd inputs; real CBU rates and prices are far shorter. */
const MAX_DECIMAL_LENGTH = 40;
const CURRENCIES: readonly string[] = ["USD", "EUR", "RUB"];

interface Decimal {
  /** All digits as one integer: "11772.95" -> 1177295n. */
  units: bigint;
  /** Number of fractional digits: "11772.95" -> 2. */
  scale: number;
}

function parseDecimal(text: unknown, what: string): Decimal {
  if (typeof text !== "string" || text.length > MAX_DECIMAL_LENGTH) {
    throw new RangeError(`${what} must be a decimal string of at most ${String(MAX_DECIMAL_LENGTH)} characters`);
  }
  const m = DECIMAL.exec(text);
  if (!m) throw new RangeError(`${what} must be a plain non-negative decimal string, got ${JSON.stringify(text)}`);
  const fraction = m[2] ?? "";
  return { units: BigInt(`${m[1] as string}${fraction}`), scale: fraction.length };
}

/**
 * amount x rate / nominal in whole sums, half-up (ARCHITECTURE 4.5, ADR-004).
 * Integer arithmetic only: both numbers are decimal strings, the result is exact before the single rounding.
 */
export function convertToSum(amount: string, fx: FxRate): Sum {
  if (!CURRENCIES.includes(fx.ccy)) throw new RangeError(`Unknown currency: ${String(fx.ccy)}`);
  if (!Number.isSafeInteger(fx.nominal) || fx.nominal <= 0) {
    throw new RangeError(`Nominal must be a positive integer, got ${String(fx.nominal)}`);
  }
  const a = parseDecimal(amount, "amount");
  const r = parseDecimal(fx.rate, "rate");
  if (r.units === 0n) throw new RangeError("rate must be positive");
  const numerator = a.units * r.units;
  const denominator = 10n ** BigInt(a.scale + r.scale) * BigInt(fx.nominal);
  const rounded = (2n * numerator + denominator) / (2n * denominator); // half-up; operands are non-negative
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("converted amount exceeds the safe integer range");
  return sum(Number(rounded));
}
