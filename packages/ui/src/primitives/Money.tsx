import { formatAmount, NBSP } from "../format/format.ts";

/**
 * A whole sum in mono type with tabular figures. The raw number is in `value` for machines; the text has
 * non-breaking spaces, so the sum never wraps. A fraction is refused: sums are whole numbers (CLAUDE.md).
 */
export function Money({ amount, unit }: { amount: number; unit?: string }) {
  return (
    <data className="nv-num nv-money" value={String(amount)}>
      {unit ? `${formatAmount(amount)}${NBSP}${unit}` : formatAmount(amount)}
    </data>
  );
}
