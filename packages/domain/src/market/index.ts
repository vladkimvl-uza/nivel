import { NotImplementedError } from "../errors.ts";
import type { Sum } from "../money/types.ts";
import type { FxRate, MarketApi, MarketPolicy, MarketPrice, PriceObservation } from "./types.ts";

export type * from "./types.ts";

export function convertToSum(_amount: string, _fx: FxRate): Sum {
  throw new NotImplementedError("market.convertToSum");
}
export function computeMarketPrice(_obs: readonly PriceObservation[], _now: Date, _policy: MarketPolicy): MarketPrice {
  throw new NotImplementedError("market.computeMarketPrice");
}

export const marketApi = { convertToSum, computeMarketPrice } satisfies MarketApi;
