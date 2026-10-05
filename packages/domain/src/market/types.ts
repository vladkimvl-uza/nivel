// Frozen contract (ARCHITECTURE 4.5). Change only via ADR and a "contract" PR.
import type { ProductId } from "../catalog/types.ts";
import type { IsoDate, Sum } from "../money/types.ts";

export interface PriceObservation {
  id: string;
  productId: ProductId;
  vendorId: string;
  vendorKind: "partner" | "shop" | "marketplace_seller" | "private";
  observedAt: Date;
  priceSum: Sum;
  availability: "in_stock" | "on_order" | "preorder" | "ask";
  condition: "new" | "refurb" | "used";
  isFromPrice: boolean;
}
export interface FxRate {
  ccy: "USD" | "EUR" | "RUB";
  rate: string;
  nominal: number;
  effectiveDate: IsoDate;
}
export interface MarketPolicy {
  freshnessDays: number; // 7; GPU volatile 3; furniture 30 (by category)
  minVendors: number; // 3
  smallSampleBand: [number, number]; // [0.6, 1.6] for 3–5 offers
  madK: number; // 3.5 (× 1.4826 × MAD) for ≥ 6 offers
  currencyErrorRatio: number; // 1000: price < median / 1000 → dollars typed into sums
  high: { vendors: number; maxAgeDays: number }; // 5, 3
}
export type ExcludeReason =
  | "outlier"
  | "currency_error"
  | "stale"
  | "not_in_stock"
  | "from_price"
  | "private_seller"
  | "duplicate_vendor"
  | "used_or_refurb";
export interface MarketPrice {
  productId: ProductId;
  asOf: Date;
  median: Sum | null;
  from: Sum | null;
  min: Sum | null;
  max: Sum | null;
  offers: number;
  vendors: number;
  maxAgeDays: number;
  confidence: "high" | "medium" | "low";
  flags: ("outlier_removed" | "currency_suspect" | "same_price_cluster")[];
  excluded: { observationId: string; reason: ExcludeReason }[];
}

export interface MarketApi {
  /** decimal-string rate × amount / nominal, half-up to whole sums; no floats in money. */
  convertToSum(amount: string, fx: FxRate): Sum;
  computeMarketPrice(obs: readonly PriceObservation[], now: Date, policy: MarketPolicy): MarketPrice;
}
