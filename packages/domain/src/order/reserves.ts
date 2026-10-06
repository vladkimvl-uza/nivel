// Reserve contributions emitted as `ledger` effects (ARCHITECTURE 4.8, DECISIONS R-12).
// The frozen `transition` signature carries no reserve balance, closed-order count or loss history, so the
// first-stage rules apply: they are right while the warranty fund is below 10 million sum or fewer than 30 orders
// are closed (the first months), and they err on the side of a bigger reserve afterwards. The state-dependent rules
// live in warrantyReserveContribution and taxRiskReserve (WP-01); services may override these amounts.
import type { Sum } from "../money/types.ts";

const BP_DENOMINATOR = 10_000;
/** Tax risk reserve: 1 % of purchases until the tax authority answers in writing. */
const TAX_RISK_BP = 100;
/** Warranty reserve: 2 % of components, at least 150 000 sum per order. */
const WARRANTY_BP = 200;
const WARRANTY_MIN = 150_000;

/** floor(base × bp / 10 000) in exact integer arithmetic. */
function floorBp(base: number, bp: number): number {
  const scaled = base * bp;
  return (scaled - (scaled % BP_DENOMINATOR)) / BP_DENOMINATOR;
}

/** Tax risk reserve contribution from the receipts of the order. */
export function receiptsReserve(receiptsTotal: Sum): Sum {
  return floorBp(receiptsTotal, TAX_RISK_BP) as Sum;
}

/** Warranty reserve contribution; receipts of the order stand in for the components sum. */
export function warrantyReserve(receiptsTotal: Sum): Sum {
  return Math.max(floorBp(receiptsTotal, WARRANTY_BP), WARRANTY_MIN) as Sum;
}
