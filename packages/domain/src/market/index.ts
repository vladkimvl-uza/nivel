import { convertToSum } from "./convert.ts";
import { computeMarketPrice } from "./price.ts";
import type { MarketApi } from "./types.ts";

export { convertToSum } from "./convert.ts";
export { DEFAULT_MARKET_POLICY, FRESHNESS_DAYS_BY_CATEGORY, marketPolicyFor } from "./policy.ts";
export { computeMarketPrice } from "./price.ts";
export type * from "./types.ts";

/** Compile-time check: the implementation matches the frozen contract. */
export const marketApi = { convertToSum, computeMarketPrice } satisfies MarketApi;
