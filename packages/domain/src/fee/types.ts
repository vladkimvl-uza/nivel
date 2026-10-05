// Frozen contract (ARCHITECTURE 4.6). Change only via ADR and a "contract" PR.
import type { FeeGroup, ProductId } from "../catalog/types.ts";
import type { Bp, IsoDate, Sum } from "../money/types.ts";

export type FeeStage = "selection" | "purchase" | "assembly" | "handover";

export interface FeeSettings {
  version: string;
  effectiveFrom: IsoDate; // published price list with date (GK art. 662)
  pcLowRateBp: Bp;
  pcHighRateBp: Bp;
  pcThreshold: Sum;
  pcHighMinFee: Sum; // 1500, 1000, 20 000 000, 3 000 000
  mountRateBp: Bp;
  complexRateBp: Bp; // 1500, 1500
  minFullCyclePc: Sum;
  minFreeWindowPc: Sum;
  minFullCycleSetup: Sum; // 6 700 000, 4 500 000, 13 300 000
  stageSharesBp: { selection: Bp; purchase: Bp; assembly: Bp; handover: Bp }; // 2000/3000/3500/1500, Σ = 10 000
  commissionLineStages: FeeStage[]; // ["selection","purchase"] → 50 %
  advanceBp: Bp; // 3000: 30 % at acceptance, 70 % at handover
  reserveBp: Bp;
  reserveHighBp: Bp;
  reserveHighShareBp: Bp; // 300, 500, 2500 (RAM+SSD ≥ 25 % → 5 %; owner confirms)
  reserveRoundStep: number; // 10 000, round up
  podborShareBp: Bp;
  podborCreditDays: number; // 2000, 30
  afterTestsRetainBp: Bp; // 8500 (lawyer confirms with the offer)
  shelfLifeHours: { components: number; furniture: number }; // 24, 72
}
export interface QuoteLineInput {
  key: string;
  productId?: ProductId;
  group: FeeGroup;
  qty: number;
  unitSum: Sum;
  isRamOrSsd: boolean;
  isFurnitureLike: boolean;
  customerOwned: boolean;
  purchasedByIp: boolean;
}
export interface FeePart {
  group: "pc" | "mount";
  base: Sum;
  rateBp: Bp;
  amount: Sum;
  rule: "pc_low" | "pc_high" | "pc_high_min" | "mount" | "complex";
}
export interface FeeBreakdown {
  parts: FeePart[];
  total: Sum;
  effectiveRateBp: Bp;
  commissionLine: Sum; // «вознаграждение за закупку и ручательство»
  worksLine: Sum; // «работы»; commissionLine + worksLine === total
}
export type Eligibility =
  | { mode: "full_cycle" }
  | { mode: "free_window_only"; minEstimate: Sum }
  | { mode: "podbor_only"; reason: "below_min" | "region" | "manual" }
  | { mode: "setup_below_min" };
export interface QuoteTotals {
  componentsSum: Sum; // fee base: pc + mount groups, customer-owned excluded
  outsideScaleSum: Sum; // licenses, freight, partner works: no fee
  reserveBp: Bp;
  reserveSum: Sum;
  purchaseLimit: Sum; // Σ purchasedByIp lines + reserve → transferred to the IP account
  fee: FeeBreakdown;
  advance: Sum;
  final: Sum; // advance + final === fee.total
  grandTotal: Sum; // purchaseLimit + fee.total
  eligibility: Eligibility;
  validUntil?: Date; // only for an owner-confirmed estimate
  warnings: { key: string; params?: Record<string, string | number> }[]; // price uncertain, demo data
}
export interface QuoteContext {
  now: Date;
  kind: "pc" | "setup";
  complexBuild: boolean;
  freeWindowAvailable: boolean;
  confirmed: boolean;
}

export interface FeeApi {
  computeFee(lines: readonly QuoteLineInput[], s: FeeSettings, o: { complexBuild: boolean }): FeeBreakdown;
  computeQuote(lines: readonly QuoteLineInput[], s: FeeSettings, ctx: QuoteContext): QuoteTotals;
  podborFee(fee: FeeBreakdown, s: FeeSettings): Sum;
  partsBudgetFromTotal(total: Sum, s: FeeSettings, reserveBp: Bp): Sum;
}
