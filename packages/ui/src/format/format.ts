// Display of money and rates (DESIGN_SYSTEM 2.3): whole sums with a non-breaking space between thousands, percent
// with a comma. Integers only, as everywhere in the money code: the arithmetic is done by `packages/domain` on the
// server; this module only writes numbers down.

/** Between thousands and before `%`: a sum must not wrap ("2 683 / 000" was a bug of the prototype). */
export const NBSP = " ";
/** The true minus sign; a hyphen is too short in front of a sum. */
export const MINUS = "−";

function assertInteger(value: number, what: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a safe integer, got ${String(value)}`);
  }
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** `26830000` -> `26 830 000` (U+00A0); a refund `-140000` -> `−140 000`. */
export function formatAmount(sum: number): string {
  assertInteger(sum, "a sum");
  const text = group(String(Math.abs(sum)));
  return sum < 0 ? `${MINUS}${text}` : text;
}

/** Basis points as percent: `1500` -> `15 %`, `1250` -> `12,5 %`, `5` -> `0,05 %`. No float arithmetic. */
export function formatBp(bp: number): string {
  assertInteger(bp, "a rate in basis points");
  const abs = Math.abs(bp);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  const text = fraction === "" ? String(whole) : `${whole},${fraction}`;
  return `${bp < 0 ? MINUS : ""}${text}${NBSP}%`;
}
