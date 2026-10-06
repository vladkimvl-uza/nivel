// ARCHITECTURE 4.1: defaults of the domain match the documents, and a test compares them.
import { describe, expect, it } from "vitest";
import type { CategoryCode } from "../catalog/types.ts";
import { repoFile } from "../money/testkit.ts";
import { DEFAULT_MARKET_POLICY, FRESHNESS_DAYS_BY_CATEGORY, marketPolicyFor } from "./index.ts";

const architecture = repoFile("docs/ARCHITECTURE.md");
const flat = architecture.replace(/\s+/g, " ");

/** Policy block of ARCHITECTURE 4.5: field name → trailing comment. */
function policyComment(field: string): string {
  const m = new RegExp(`^\\s*${field}:[^\\n]*?//\\s*([^\\n]*)`, "m").exec(architecture);
  if (!m) throw new Error(`No ${field} in ARCHITECTURE 4.5`);
  return m[1] as string;
}

describe("DEFAULT_MARKET_POLICY vs ARCHITECTURE 4.5", () => {
  const P = DEFAULT_MARKET_POLICY;

  it("freshness: 7 days by default", () => {
    expect(policyComment("freshnessDays")).toMatch(new RegExp(`^${String(P.freshnessDays)};`));
  });
  it("minVendors: 3", () => {
    expect(policyComment("minVendors")).toMatch(new RegExp(`^${String(P.minVendors)}\\b`));
  });
  it("small-sample band: [0.6, 1.6]", () => {
    expect(policyComment("smallSampleBand")).toContain(
      `[${String(P.smallSampleBand[0])}, ${String(P.smallSampleBand[1])}]`,
    );
  });
  it("MAD coefficient: 3.5", () => {
    expect(policyComment("madK")).toMatch(new RegExp(`^${String(P.madK)}\\b`));
  });
  it("currency error ratio: 1000", () => {
    expect(policyComment("currencyErrorRatio")).toMatch(new RegExp(`^${String(P.currencyErrorRatio)}:`));
  });
  it("high confidence: 5 vendors, 3 days", () => {
    expect(policyComment("high")).toContain(`${String(P.high.vendors)}, ${String(P.high.maxAgeDays)}`);
  });
  it("the document fixes the MAD scale 1.4826", () => {
    expect(flat).toContain("3.5 (× 1.4826 × MAD)");
  });
  it("has exactly the contract fields", () => {
    expect(Object.keys(P).sort()).toEqual(
      ["currencyErrorRatio", "freshnessDays", "high", "madK", "minVendors", "smallSampleBand"].sort(),
    );
  });
  it("is immutable, including nested values", () => {
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(P.high)).toBe(true);
    expect(Object.isFrozen(P.smallSampleBand)).toBe(true);
  });
});

describe("freshness by category (block 08, 5.5)", () => {
  const docCodes = (): string[] => {
    const m = /\| `categories` \| `code` \(([^)]*)\)/.exec(architecture);
    if (!m) throw new Error("categories row not found in ARCHITECTURE 3.3");
    return (m[1] as string).split(",").map((s) => s.trim());
  };

  it("covers exactly the categories of the data model", () => {
    expect(Object.keys(FRESHNESS_DAYS_BY_CATEGORY).sort()).toEqual(docCodes().sort());
  });
  it("only uses the documented windows 7 / 3 / 30 days", () => {
    expect(architecture).toContain("`freshness_days` (7/3/30)");
    for (const days of Object.values(FRESHNESS_DAYS_BY_CATEGORY)) expect([3, 7, 30]).toContain(days);
  });
  it.each<[CategoryCode, number]>([
    ["gpu", 3],
    ["cpu", 7],
    ["ssd", 7],
    ["monitor", 7],
    ["keyboard", 7],
    ["desk", 30],
    ["chair", 30],
    ["light", 30],
    ["decor", 30],
  ])("%s → %i days", (category, days) => {
    expect(FRESHNESS_DAYS_BY_CATEGORY[category]).toBe(days);
  });
  it("the table is immutable", () => {
    expect(Object.isFrozen(FRESHNESS_DAYS_BY_CATEGORY)).toBe(true);
  });
});

describe("marketPolicyFor", () => {
  it("substitutes the category window and keeps the rest of the policy", () => {
    expect(marketPolicyFor("gpu")).toEqual({ ...DEFAULT_MARKET_POLICY, freshnessDays: 3 });
    expect(marketPolicyFor("desk").freshnessDays).toBe(30);
    expect(marketPolicyFor("cpu")).toEqual(DEFAULT_MARKET_POLICY);
  });
  it("accepts a base policy from settings", () => {
    const base = { ...DEFAULT_MARKET_POLICY, minVendors: 4 };
    expect(marketPolicyFor("gpu", base)).toEqual({ ...base, freshnessDays: 3 });
  });
  it("returns a fresh object, not the frozen default", () => {
    expect(marketPolicyFor("cpu")).not.toBe(DEFAULT_MARKET_POLICY);
  });
  it("rejects an unknown category", () => {
    expect(() => marketPolicyFor("sofa" as unknown as CategoryCode)).toThrow(RangeError);
  });
});
