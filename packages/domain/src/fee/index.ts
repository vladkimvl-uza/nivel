import { NotImplementedError } from "../errors.ts";
import type { Bp, Sum } from "../money/types.ts";
import type { FeeApi, FeeBreakdown, FeeSettings, QuoteContext, QuoteLineInput, QuoteTotals } from "./types.ts";

export type * from "./types.ts";

export function computeFee(
  _lines: readonly QuoteLineInput[],
  _s: FeeSettings,
  _o: { complexBuild: boolean },
): FeeBreakdown {
  throw new NotImplementedError("fee.computeFee");
}
export function computeQuote(_lines: readonly QuoteLineInput[], _s: FeeSettings, _ctx: QuoteContext): QuoteTotals {
  throw new NotImplementedError("fee.computeQuote");
}
export function podborFee(_fee: FeeBreakdown, _s: FeeSettings): Sum {
  throw new NotImplementedError("fee.podborFee");
}
export function partsBudgetFromTotal(_total: Sum, _s: FeeSettings, _reserveBp: Bp): Sum {
  throw new NotImplementedError("fee.partsBudgetFromTotal");
}

export const feeApi = { computeFee, computeQuote, podborFee, partsBudgetFromTotal } satisfies FeeApi;
