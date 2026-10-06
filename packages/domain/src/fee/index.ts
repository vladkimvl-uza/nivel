import { addSums, applyBp, type Bp, bp, roundTo, type Sum, splitByShares, sum } from "../money/index.ts";
import type {
  Eligibility,
  FeeApi,
  FeeBreakdown,
  FeePart,
  FeeSettings,
  FeeStage,
  QuoteContext,
  QuoteLineInput,
  QuoteTotals,
} from "./types.ts";

export { DEFAULT_FEE_SETTINGS } from "./defaults.ts";
export type * from "./types.ts";

const HOUR_MS = 3_600_000;

/** qty × unitSum with input checks; throws RangeError on fractions, negatives and unsafe products. */
function lineTotal(l: QuoteLineInput): Sum {
  if (!Number.isSafeInteger(l.qty) || l.qty < 0) throw new RangeError(`Line ${l.key}: qty must be an integer >= 0`);
  if (sum(l.unitSum) < 0) throw new RangeError(`Line ${l.key}: unitSum must not be negative`);
  return sum(l.qty * l.unitSum);
}

/** Fee of one PC-scale base: below the threshold the low rate, from it the high rate with a minimum; complex build is low-rate. */
function pcPart(base: Sum, s: FeeSettings, complexBuild: boolean): FeePart {
  if (complexBuild) {
    return {
      group: "pc",
      base,
      rateBp: s.complexRateBp,
      amount: applyBp(base, s.complexRateBp, "floor"),
      rule: "complex",
    };
  }
  if (base < s.pcThreshold) {
    return { group: "pc", base, rateBp: s.pcLowRateBp, amount: applyBp(base, s.pcLowRateBp, "floor"), rule: "pc_low" };
  }
  const scaled = applyBp(base, s.pcHighRateBp, "floor");
  return scaled >= s.pcHighMinFee
    ? { group: "pc", base, rateBp: s.pcHighRateBp, amount: scaled, rule: "pc_high" }
    : { group: "pc", base, rateBp: s.pcHighRateBp, amount: s.pcHighMinFee, rule: "pc_high_min" };
}

/** Fee on the PC scale, no complex build. Used by the budget inversion. */
function pcScaleFee(base: Sum, s: FeeSettings): Sum {
  return pcPart(base, s, false).amount;
}

/**
 * Fee by the scale, rounded down to a whole sum (ADR-004). Customer-owned and outside-scale lines carry no fee.
 * Two document lines: "commission" gets the shares of commissionLineStages, "works" the rest; the odd sum goes to commission.
 */
export function computeFee(
  lines: readonly QuoteLineInput[],
  s: FeeSettings,
  o: { complexBuild: boolean },
): FeeBreakdown {
  let pcBase = sum(0);
  let mountBase = sum(0);
  for (const l of lines) {
    const total = lineTotal(l);
    if (l.customerOwned) continue;
    switch (l.group) {
      case "pc":
        pcBase = addSums(pcBase, total);
        break;
      case "mount":
        mountBase = addSums(mountBase, total);
        break;
      case "outside_scale":
        break; // outside the scale: no fee
      default:
        throw new RangeError(`Line ${l.key}: unknown fee group ${String(l.group)}`);
    }
  }
  const parts: FeePart[] = [];
  if (pcBase > 0) parts.push(pcPart(pcBase, s, o.complexBuild));
  if (mountBase > 0) {
    parts.push({
      group: "mount",
      base: mountBase,
      rateBp: s.mountRateBp,
      amount: applyBp(mountBase, s.mountRateBp, "floor"),
      rule: "mount",
    });
  }
  const total = addSums(...parts.map((p) => p.amount));
  const base = addSums(pcBase, mountBase);
  const effectiveRateBp = base > 0 ? bp(Math.min(10_000, Number((BigInt(total) * 10_000n) / BigInt(base)))) : bp(0);

  const commissionShare = [...new Set<FeeStage>(s.commissionLineStages)].reduce(
    (acc, stage) => acc + s.stageSharesBp[stage],
    0,
  );
  const [commissionLine = sum(0), worksLine = sum(0)] = splitByShares(total, [
    bp(commissionShare),
    bp(10_000 - commissionShare),
  ]);
  return { parts, total, effectiveRateBp, commissionLine, worksLine };
}

/** Reserve against price growth: rounded up to the reserve step; the rate is chosen by the memory and SSD share. */
function reserveSumFor(purchased: Sum, rate: Bp, s: FeeSettings): Sum {
  return roundTo(applyBp(purchased, rate, "ceil"), s.reserveRoundStep, "ceil");
}

function eligibilityOf(base: Sum, s: FeeSettings, ctx: QuoteContext, warnings: QuoteTotals["warnings"]): Eligibility {
  if (ctx.kind === "setup") {
    return base >= s.minFullCycleSetup ? { mode: "full_cycle" } : { mode: "setup_below_min" };
  }
  if (base >= s.minFullCyclePc) return { mode: "full_cycle" };
  if (base >= s.minFreeWindowPc) {
    if (ctx.freeWindowAvailable) return { mode: "free_window_only", minEstimate: s.minFreeWindowPc };
    warnings.push({ key: "quote.free_window_unavailable" });
  }
  return { mode: "podbor_only", reason: "below_min" };
}

/** Whole estimate: fee, reserve, purchase limit, advance/final, eligibility and validity period. */
export function computeQuote(lines: readonly QuoteLineInput[], s: FeeSettings, ctx: QuoteContext): QuoteTotals {
  const warnings: QuoteTotals["warnings"] = [];
  const fee = computeFee(lines, s, { complexBuild: ctx.complexBuild });

  let componentsSum = sum(0);
  let outsideScaleSum = sum(0);
  let purchased = sum(0);
  let memory = sum(0);
  let allFurniture = true;
  for (const l of lines) {
    const total = lineTotal(l);
    if (l.customerOwned || total === 0) continue;
    if (l.group === "outside_scale") outsideScaleSum = addSums(outsideScaleSum, total);
    else componentsSum = addSums(componentsSum, total); // computeFee above already refused any unknown group
    if (l.purchasedByIp) {
      purchased = addSums(purchased, total);
      if (l.isRamOrSsd) memory = addSums(memory, total);
    }
    if (!l.isFurnitureLike) allFurniture = false;
  }

  const highReserve = BigInt(memory) * 10_000n >= BigInt(s.reserveHighShareBp) * BigInt(purchased) && purchased > 0;
  const reserveBp = highReserve ? s.reserveHighBp : s.reserveBp;
  if (highReserve) {
    const shareBp = Number((BigInt(memory) * 10_000n) / BigInt(purchased));
    warnings.push({ key: "quote.reserve_high", params: { shareBp } });
  }
  const reserveSum = reserveSumFor(purchased, reserveBp, s);
  const purchaseLimit = addSums(purchased, reserveSum);
  const [advance = sum(0), final = sum(0)] = splitByShares(fee.total, [s.advanceBp, bp(10_000 - s.advanceBp)]);

  const eligibility = eligibilityOf(componentsSum, s, ctx, warnings);
  if (componentsSum === 0 && outsideScaleSum === 0) warnings.push({ key: "quote.empty" });

  const totals: QuoteTotals = {
    componentsSum,
    outsideScaleSum,
    reserveBp,
    reserveSum,
    purchaseLimit,
    fee,
    advance,
    final,
    grandTotal: addSums(purchaseLimit, fee.total),
    eligibility,
    warnings,
  };
  if (ctx.confirmed) {
    const hours =
      allFurniture && componentsSum + outsideScaleSum > 0 ? s.shelfLifeHours.furniture : s.shelfLifeHours.components;
    totals.validUntil = new Date(ctx.now.getTime() + hours * HOUR_MS);
  }
  return totals;
}

/** "Podbor": a share of the scale fee, rounded down; credited to the fee when the order follows within podborCreditDays. */
export function podborFee(fee: FeeBreakdown, s: FeeSettings): Sum {
  return applyBp(fee.total, s.podborShareBp, "floor");
}

/**
 * Upper limit of a client budget the inversion accepts: 1 000 000 000 000 sums (one trillion).
 * Far above any real order, far below 2^53, so the search arithmetic stays exact. Input schemas must apply the same limit.
 */
export const MAX_BUDGET_SUM = 1_000_000_000_000;

/**
 * Client budget -> parts: the largest base whose total (parts + PC-scale fee + reserve) fits the budget.
 * Exact search over the monotone cost, so both branches of the scale (15 % and 10 % with the minimum) are covered
 * and the consistent one is taken; the result always re-quotes within the budget.
 * Throws RangeError for a negative budget and for a budget above MAX_BUDGET_SUM.
 */
export function partsBudgetFromTotal(total: Sum, s: FeeSettings, reserveBp: Bp): Sum {
  if (sum(total) < 0) throw new RangeError("Budget must not be negative");
  if (total > MAX_BUDGET_SUM) throw new RangeError(`Budget must not exceed ${MAX_BUDGET_SUM} sums`);
  const cost = (parts: number): Sum => {
    const p = sum(parts);
    return addSums(p, pcScaleFee(p, s), reserveSumFor(p, reserveBp, s));
  };
  let lo = 0; // cost(0) = 0 <= total
  let hi: number = total; // cost(p) >= p, so p <= total
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2); // hi - lo is exact: no precision loss in the midpoint
    if (cost(mid) <= total) lo = mid;
    else hi = mid - 1;
  }
  return sum(lo);
}

export const feeApi = { computeFee, computeQuote, podborFee, partsBudgetFromTotal } satisfies FeeApi;
