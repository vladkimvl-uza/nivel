import { describe, expect, it } from "vitest";
import {
  CalendarSettingsSchema,
  FEATURE_FLAGS,
  FeeSettingsSchema,
  nextVersionName,
  parseHolidays,
  SETTING_KEYS,
  ThresholdSettingsSchema,
} from "./schemas.ts";

// The values the architect accepted on 05.10.2026 (same as packages/db/seed/rules.ts and domain defaults).
const fee = {
  version: "2026-10-05",
  effectiveFrom: "2026-10-05",
  pcLowRateBp: 1500,
  pcHighRateBp: 1000,
  pcThreshold: 20_000_000,
  pcHighMinFee: 3_000_000,
  mountRateBp: 1500,
  complexRateBp: 1500,
  minFullCyclePc: 6_700_000,
  minFreeWindowPc: 4_500_000,
  minFullCycleSetup: 13_300_000,
  stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
  commissionLineStages: ["selection", "purchase"],
  advanceBp: 3000,
  reserveBp: 300,
  reserveHighBp: 500,
  reserveHighShareBp: 2500,
  reserveRoundStep: 10_000,
  podborShareBp: 2000,
  podborCreditDays: 30,
  afterTestsRetainBp: 8500,
  shelfLifeHours: { components: 24, furniture: 72 },
};

describe("fee settings", () => {
  it("accepts the settings of 05.10.2026", () => {
    expect(FeeSettingsSchema.safeParse(fee).success).toBe(true);
  });

  it("keys are the ones of ops.settings", () => {
    expect(SETTING_KEYS).toEqual({
      fee: "money.fee_settings",
      feeNext: "money.fee_settings.next",
      threshold: "money.threshold",
      calendar: "calendar.work",
    });
    expect(FEATURE_FLAGS).toEqual(["feature.ai", "feature.setupConfigurator", "feature.scene", "feature.miniApp"]);
  });

  it("the stage shares must add up to 10 000 basis points", () => {
    const r = FeeSettingsSchema.safeParse({
      ...fee,
      stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1400 },
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("stageSharesBp");
  });

  it("refuses fractions and floats in money and rates, negative sums and rates above 100 %", () => {
    for (const bad of [
      { pcLowRateBp: 15.5 },
      { pcThreshold: 20_000_000.5 },
      { pcHighMinFee: -1 },
      { advanceBp: 10_001 },
      { reserveBp: -1 },
      { reserveRoundStep: 0 },
      { podborCreditDays: 0 },
      { pcLowRateBp: "1500" },
      { minFullCyclePc: Number.MAX_SAFE_INTEGER + 2 },
    ]) {
      expect(FeeSettingsSchema.safeParse({ ...fee, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses unknown keys, a bad date, an empty version, and an unknown stage", () => {
    expect(FeeSettingsSchema.safeParse({ ...fee, surprise: 1 }).success).toBe(false);
    expect(FeeSettingsSchema.safeParse({ ...fee, effectiveFrom: "2026-13-01" }).success).toBe(false);
    expect(FeeSettingsSchema.safeParse({ ...fee, effectiveFrom: "05.10.2026" }).success).toBe(false);
    expect(FeeSettingsSchema.safeParse({ ...fee, version: " " }).success).toBe(false);
    expect(FeeSettingsSchema.safeParse({ ...fee, commissionLineStages: ["selection", "delivery"] }).success).toBe(
      false,
    );
  });

  it("derives the next version name from the date and does not repeat a name", () => {
    expect(nextVersionName("2026-10-05", "2026-11-01")).toBe("2026-11-01");
    expect(nextVersionName("2026-11-01", "2026-11-01")).toBe("2026-11-01.2");
    expect(nextVersionName("2026-11-01.2", "2026-11-01")).toBe("2026-11-01.3");
    expect(nextVersionName(undefined, "2026-10-05")).toBe("2026-10-05");
  });
});

describe("threshold settings", () => {
  it("accepts the seed and a registration date", () => {
    const seed = {
      annualLimit: 1_000_000_000,
      planCap: 200_000_000,
      alertsBp: [6000, 7000, 8000, 9000, 10000],
      proportion: "without_registration_day",
    };
    expect(ThresholdSettingsSchema.safeParse(seed).success).toBe(true);
    expect(ThresholdSettingsSchema.safeParse({ ...seed, registrationDate: "2026-11-02" }).success).toBe(true);
  });

  it("alerts rise strictly and stay within 0..10 000", () => {
    const base = { annualLimit: 1, alertsBp: [6000], proportion: "with_registration_day" };
    expect(ThresholdSettingsSchema.safeParse({ ...base, alertsBp: [7000, 6000] }).success).toBe(false);
    expect(ThresholdSettingsSchema.safeParse({ ...base, alertsBp: [6000, 6000] }).success).toBe(false);
    expect(ThresholdSettingsSchema.safeParse({ ...base, alertsBp: [10001] }).success).toBe(false);
    expect(ThresholdSettingsSchema.safeParse({ ...base, proportion: "whole_year" }).success).toBe(false);
  });
});

describe("calendar settings", () => {
  const calendar = { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] };

  it("accepts the seed", () => {
    expect(CalendarSettingsSchema.safeParse(calendar).success).toBe(true);
    expect(CalendarSettingsSchema.safeParse({ ...calendar, holidays: ["2026-12-31", "2027-01-01"] }).success).toBe(
      true,
    );
  });

  it("response hours: HH:MM, the start before the end", () => {
    for (const bad of [
      { from: "9:00" },
      { from: "24:00" },
      { to: "19:60" },
      { from: "19:00", to: "10:00" },
      { from: "10:00", to: "10:00" },
    ]) {
      expect(CalendarSettingsSchema.safeParse({ ...calendar, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the work week: days 1..7 once each, at least one; the zone is Tashkent", () => {
    expect(CalendarSettingsSchema.safeParse({ ...calendar, workdays: [] }).success).toBe(false);
    expect(CalendarSettingsSchema.safeParse({ ...calendar, workdays: [1, 1] }).success).toBe(false);
    expect(CalendarSettingsSchema.safeParse({ ...calendar, workdays: [0] }).success).toBe(false);
    expect(CalendarSettingsSchema.safeParse({ ...calendar, workdays: [8] }).success).toBe(false);
    expect(CalendarSettingsSchema.safeParse({ ...calendar, tz: "Europe/Moscow" }).success).toBe(false);
  });

  it("holidays are real, distinct dates", () => {
    expect(CalendarSettingsSchema.safeParse({ ...calendar, holidays: ["2026-02-30"] }).success).toBe(false);
    expect(CalendarSettingsSchema.safeParse({ ...calendar, holidays: ["2026-12-31", "2026-12-31"] }).success).toBe(
      false,
    );
  });

  it("reads a list of holidays typed one per line, in the Russian or the ISO form, sorted", () => {
    expect(parseHolidays("2026-12-31\n01.01.2027;\n 08.03.2027,2026-12-31 ")).toEqual({
      ok: true,
      dates: ["2026-12-31", "2027-01-01", "2027-03-08"],
    });
    expect(parseHolidays("")).toEqual({ ok: true, dates: [] });
    expect(parseHolidays("31.02.2026")).toEqual({ ok: false, error: "Не дата: 31.02.2026." });
    expect(parseHolidays("завтра")).toEqual({ ok: false, error: "Не дата: завтра." });
  });
});
