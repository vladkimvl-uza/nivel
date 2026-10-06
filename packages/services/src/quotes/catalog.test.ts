import { defaultCompatSettings } from "@nivel/domain/compat";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../orders/errors.ts";
import { compatSettingsFrom } from "./catalog.ts";

describe("compatSettingsFrom: the thresholds of the published rule set over the defaults of the domain", () => {
  it("falls back to the defaults when the rule set has none", () => {
    for (const payload of [undefined, null, {}, { compat: null }]) {
      expect(compatSettingsFrom(payload)).toEqual(defaultCompatSettings());
    }
  });

  it("takes what the owner changed and keeps the rest", () => {
    const s = compatSettingsFrom({ compat: { psuMultiplier: 1.5, gpuLenWarnMarginMm: 20 } });
    expect(s.psuMultiplier).toBe(1.5);
    expect(s.gpuLenWarnMarginMm).toBe(20);
    expect(s.baseW).toBe(defaultCompatSettings().baseW);
  });

  it.each([
    [{ compat: [] }],
    [{ compat: "x" }],
    [{ compat: { psuMultiplier: "1.3" } }],
    [{ compat: { baseW: Number.NaN } }],
    [{ compat: { psuSeriesW: [550, "650"] } }],
    [{ compat: { psuSeriesW: 650 } }],
    [{ compat: { eyeDistanceMm: [500] } }],
    [{ compat: { standDepthMm: [150, "250"] } }],
  ])("refuses a broken rule set: %j", (payload) => {
    expect(() => compatSettingsFrom(payload)).toThrow(ConfigError);
  });
});
