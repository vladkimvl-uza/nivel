import { bp, sum } from "../money/index.ts";
import type { FeeSettings } from "./types.ts";

function deepFreeze<T>(value: T): T {
  // Always descend: the children of an already (shallow) frozen object may still be mutable. Settings have no cycles.
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * Default money rules accepted by the owner on 05.10.2026 (DECISIONS R-8, R-9, R-26 and the note on default rules).
 * A test compares these values with the document; the live values come from ops.settings.
 */
export const DEFAULT_FEE_SETTINGS: FeeSettings = deepFreeze({
  version: "2026-10-05",
  effectiveFrom: "2026-10-05",
  pcLowRateBp: bp(1500),
  pcHighRateBp: bp(1000),
  pcThreshold: sum(20_000_000),
  pcHighMinFee: sum(3_000_000),
  mountRateBp: bp(1500),
  complexRateBp: bp(1500),
  minFullCyclePc: sum(6_700_000),
  minFreeWindowPc: sum(4_500_000),
  minFullCycleSetup: sum(13_300_000),
  stageSharesBp: { selection: bp(2000), purchase: bp(3000), assembly: bp(3500), handover: bp(1500) },
  commissionLineStages: ["selection", "purchase"],
  advanceBp: bp(3000),
  reserveBp: bp(300),
  reserveHighBp: bp(500),
  reserveHighShareBp: bp(2500),
  reserveRoundStep: 10_000,
  podborShareBp: bp(2000),
  podborCreditDays: 30,
  afterTestsRetainBp: bp(8500),
  shelfLifeHours: { components: 24, furniture: 72 },
});
