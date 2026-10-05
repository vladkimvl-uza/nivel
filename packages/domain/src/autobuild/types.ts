// Frozen contract (ARCHITECTURE 4.11). Change only via ADR and a "contract" PR.
import type { BuildLine, CatalogLookup, CategoryCode, ProductId } from "../catalog/types.ts";
import type { CompatResult, CompatSettings, Task } from "../compat/types.ts";
import type { FeeSettings, QuoteTotals } from "../fee/types.ts";
import type { MarketPrice } from "../market/types.ts";
import type { Bp, Sum } from "../money/types.ts";

export type Tier = "T1" | "T2" | "T3" | "T4"; // parts: < 12M, 12–20M, 20–35M, ≥ 35M
export interface StylePrefs {
  color: "black" | "white" | "any";
  lighting: "none" | "calm" | "custom";
  size: "compact" | "regular" | "large";
  quiet: boolean;
}
export interface AutobuildInput {
  tasks: [Task] | [Task, Task];
  totalBudget: Sum | "show_options";
  style: StylePrefs;
  owned?: BuildLine[];
}
export interface BaseBuildTemplate {
  key: string;
  task: Task;
  tier: Tier;
  style: "A" | "B";
  variant: "base" | "plus";
  status: "offered" | "not_offered";
  redirectTask?: Task;
  slots: { slot: CategoryCode; priceClassId?: string; productId?: ProductId; qty: number }[];
}
export type LadderName = "gpu" | "cpu" | "ram" | "ssd";
export interface SelectionSettings {
  tierBounds: { t1: Sum; t2: Sum; t3: Sum }; // 12 / 20 / 35 M
  ladders: Record<LadderName, string[]>; // ordered price class keys
  primaryLadder: Record<Task, LadderName[]>; // block 28, 1.5
  secondaryOrder: Record<Task, LadderName[]>;
  minimums: Record<Task, { minTier?: Tier; minRamGb?: number; minVramGb?: number; requiresGpu?: boolean }>;
  budgetTolerance: Bp; // 1000
  whiteSurchargeMax: Bp; // 1000
  manualOnlyClassKeys: string[];
  manualOnlyPartAbove: Sum; // RTX 5090, 128 GB, ITX, Threadripper; 60 M
}
export interface Candidate {
  lines: BuildLine[];
  partsSum: Sum;
  quote: QuoteTotals;
  compat: CompatResult;
}
export interface AutobuildResult {
  tier: Tier;
  templateKey: string;
  main: Candidate;
  cheaper?: Candidate;
  stronger?: Candidate;
  explanation: { messageKey: string; params: Record<string, string | number> }[];
  notOffered?: { messageKey: string; suggestTask?: Task };
  priceUncertain: ProductId[];
}
export interface AutobuildData {
  catalog: CatalogLookup;
  prices: ReadonlyMap<ProductId, MarketPrice>;
  templates: readonly BaseBuildTemplate[];
  sel: SelectionSettings;
  fee: FeeSettings;
  compat: CompatSettings;
  now: Date;
}
export interface ReplacementData {
  catalog: CatalogLookup;
  prices: ReadonlyMap<ProductId, MarketPrice>;
  compat: CompatSettings;
}
export interface ReplacementOption {
  productId: ProductId;
  deltaSum: Sum;
  disabledReasonKey?: string;
}

export interface AutobuildApi {
  autobuild(input: AutobuildInput, data: AutobuildData): AutobuildResult;
  replacementOptions(lines: BuildLine[], slot: CategoryCode, data: ReplacementData, limit: number): ReplacementOption[];
}
