// The numbers of the price list as the words the texts take (`{lowRate}`, `{threshold}`, `{minFee}` ...): one place that turns
// the fee settings of the owner into text, so that no page repeats "15 %" or "20 млн" by hand. Whole sums, no floating point.
import { type AppLocale, formatDate } from "@nivel/i18n";
import { type FeeScale, noJumpUpTo, pcFee, reserveRange, salePercent } from "./fee-scale.ts";
import { formatMln, formatSumsOf } from "./format.ts";
import { sampleOrder } from "./sample-order.ts";

const NBSP = " ";
const SUM_WORD: Record<AppLocale, string> = { uz: "soʻm", ru: "сум" };

export function priceParams(scale: Readonly<FeeScale>, locale: AppLocale) {
  const mln = (n: number) => formatMln(n, locale);
  const order = sampleOrder(scale);
  const noJump = noJumpUpTo(scale);
  return {
    hours: scale.shelfComponentsHours,
    date: formatDate(scale.effectiveFrom, locale),
    lowRate: salePercent(scale.pcLowRateBp),
    highRate: salePercent(scale.pcHighRateBp),
    mountRate: salePercent(scale.mountRateBp),
    threshold: mln(scale.pcThreshold),
    minFee: mln(scale.pcHighMinFee),
    noJump: mln(noJump),
    advance: salePercent(scale.advanceBp),
    final: salePercent(10_000 - scale.advanceBp),
    reserve: reserveRange(scale),
    minPc: mln(scale.minFullCyclePc),
    minSetup: mln(scale.minFullCycleSetup),
    minFree: mln(scale.minFreeWindowPc),
    selection: salePercent(scale.stageSharesBp.selection),
    purchase: salePercent(scale.stageSharesBp.purchase),
    assembly: salePercent(scale.stageSharesBp.assembly),
    handover: salePercent(scale.stageSharesBp.handover),
    chartFrom: mln(5_000_000),
    chartTo: mln(60_000_000),
    feeFrom: mln(pcFee(5_000_000, scale)),
    feeTo: mln(pcFee(60_000_000, scale)),
    // the note of the second step: the sample order and the stretch where the minimum applies
    parts: `${mln(order.partsEstimate)}${NBSP}${SUM_WORD[locale]}`,
    fee: mln(order.fee),
    from: mln(scale.pcThreshold),
    to: mln(noJump),
    refund: formatSumsOf(order.refund, locale),
  };
}

export type PriceParams = ReturnType<typeof priceParams>;
