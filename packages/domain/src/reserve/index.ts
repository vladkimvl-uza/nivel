// Reserve contracts are declared with the threshold types (ARCHITECTURE 4.8).
import { applyBp, bp, type Sum, sum } from "../money/index.ts";
import type { ReserveApi, WarrantyReserveState } from "../threshold/types.ts";

export type { ReserveApi, WarrantyReserveState } from "../threshold/types.ts";

/** Warranty reserve rules (DECISIONS R-12, CONCEPT 2.6): 2 % with a minimum, then 1 % when losses stay low. */
export const WARRANTY_RESERVE = Object.freeze({
  rateBp: 200,
  minSum: 150_000,
  matureRateBp: 100,
  matureBalance: 10_000_000,
  matureOrders: 30,
  matureMaxLossesBp: 50,
});

/** Tax-risk reserve: 1 % of purchase receipts until the tax authority answers in writing (DECISIONS R-7). */
export const TAX_RISK_RESERVE_BP = 100;

/**
 * Contribution of one order, rounded up so the fund is never short. Until the balance reaches 10 mln or 30 orders are closed,
 * and while losses of the last 12 months are 0.5 % and more: 2 % but not less than 150 000. Otherwise 1 % without a minimum.
 */
export function warrantyReserveContribution(componentsSum: Sum, st: WarrantyReserveState): Sum {
  const base = sum(componentsSum);
  if (base < 0) throw new RangeError("Components sum must not be negative");
  if (base === 0) return sum(0);
  const matured =
    sum(st.balance) >= WARRANTY_RESERVE.matureBalance &&
    st.closedOrders >= WARRANTY_RESERVE.matureOrders &&
    st.lossesLast12mBp < WARRANTY_RESERVE.matureMaxLossesBp;
  if (matured) return applyBp(base, bp(WARRANTY_RESERVE.matureRateBp), "ceil");
  return sum(Math.max(applyBp(base, bp(WARRANTY_RESERVE.rateBp), "ceil"), WARRANTY_RESERVE.minSum));
}

export function taxRiskReserve(receiptsTotal: Sum, active: boolean): Sum {
  const total = sum(receiptsTotal);
  if (total < 0) throw new RangeError("Receipts total must not be negative");
  return active ? applyBp(total, bp(TAX_RISK_RESERVE_BP), "ceil") : sum(0);
}

export const reserveApi = { warrantyReserveContribution, taxRiskReserve } satisfies ReserveApi;
