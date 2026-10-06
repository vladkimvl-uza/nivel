import { describe, expect, it } from "vitest";
import * as domain from "./index.ts";

// WP-00 freezes the contracts; owning work packages replace the stubs and add real tests.
const expected = [
  "sum",
  "bp",
  "applyBp",
  "roundTo",
  "splitByShares",
  "addSums",
  "checkCompatibility",
  "checkSetup",
  "estimatePower",
  "convertToSum",
  "computeMarketPrice",
  "computeFee",
  "computeQuote",
  "podborFee",
  "partsBudgetFromTotal",
  "settleCancellation",
  "thresholdForYear",
  "thresholdStatus",
  "warrantyReserveContribution",
  "taxRiskReserve",
  "transition",
  "customerStatus",
  "warrantyTransition",
  "warrantyDeadlines",
  "createWorkCalendar",
  "autobuild",
  "replacementOptions",
  "normalizeUz",
  "uzSearchKey",
] as const;

describe("domain contracts", () => {
  it.each(expected)("exports %s", (name) => {
    expect(typeof (domain as Record<string, unknown>)[name]).toBe("function");
  });

  it("stubs throw NotImplementedError until implemented", () => {
    // Probe a stub that stays unimplemented until WP-05 (autobuild, MVP-1).
    expect(() => (domain.autobuild as unknown as () => void)()).toThrow(domain.NotImplementedError);
  });
});
