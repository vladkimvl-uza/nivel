// The wish of a visitor about the budget, typed in million sums ("27", "27,5", "6.7"). Money is whole sums: the text is
// cut by hand, no floating point is involved, so 0.29 million is exactly 290 000 sums.

/** A wish above this is a typing mistake or a joke; the services cap the budget much higher (MAX_BUDGET_SUM). */
export const MAX_BUDGET_MILLIONS = 1000;
const SUMS_PER_MILLION = 1_000_000;
const SUMS_PER_THOUSAND = 1_000;
const FIELD = /^([0-9]{1,4})(?:[.,]([0-9]{1,3}))?$/;

export type BudgetParse = { ok: true; sum: number | undefined } | { ok: false };

/** Empty input means "no budget stated"; anything that is not a positive amount up to the maximum is refused. */
export function parseBudgetMillions(raw: string | undefined): BudgetParse {
  const text = (raw ?? "").replace(/\s/g, "");
  if (text === "") return { ok: true, sum: undefined };
  const m = FIELD.exec(text);
  if (!m) return { ok: false };
  const whole = Number(m[1]);
  const thousands = Number((m[2] ?? "").padEnd(3, "0"));
  const sum = whole * SUMS_PER_MILLION + thousands * SUMS_PER_THOUSAND;
  if (sum <= 0 || sum > MAX_BUDGET_MILLIONS * SUMS_PER_MILLION) return { ok: false };
  return { ok: true, sum };
}
