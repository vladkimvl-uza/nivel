import { describe, expect, it } from "vitest";
import { formDataSource, readFields } from "../form.ts";
import {
  CALENDAR_FIELDS,
  calendarFromForm,
  calendarToValues,
  FEE_ROOT,
  FLAG_FIELDS,
  flagsFromForm,
  flagsToValues,
  THRESHOLD_ROOT,
} from "./forms.ts";
import { CalendarSettingsSchema, FeeSettingsSchema, ThresholdSettingsSchema } from "./schemas.ts";

const fd = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};

describe("fee form", () => {
  it("has every field of the contract except the version, which is named by the date", () => {
    const keys = FEE_ROOT.children?.map((c) => c.key);
    expect(keys).toContain("effectiveFrom");
    expect(keys).not.toContain("version");
    expect(keys).toHaveLength(Object.keys(FeeSettingsSchema.shape).length - 1);
  });

  it("reads a typed form back into valid settings", () => {
    const entries: [string, string][] = [
      ["effectiveFrom", "2026-11-01"],
      ["pcLowRateBp", "1400"],
      ["pcHighRateBp", "1000"],
      ["pcThreshold", "20 000 000"],
      ["pcHighMinFee", "3000000"],
      ["mountRateBp", "1500"],
      ["complexRateBp", "1500"],
      ["minFullCyclePc", "6700000"],
      ["minFreeWindowPc", "4500000"],
      ["minFullCycleSetup", "13300000"],
      ["stageSharesBp.selection", "2000"],
      ["stageSharesBp.purchase", "3000"],
      ["stageSharesBp.assembly", "3500"],
      ["stageSharesBp.handover", "1500"],
      ["commissionLineStages", "selection"],
      ["commissionLineStages", "purchase"],
      ["commissionLineStages.__present", "1"],
      ["advanceBp", "3000"],
      ["reserveBp", "300"],
      ["reserveHighBp", "500"],
      ["reserveHighShareBp", "2500"],
      ["reserveRoundStep", "10000"],
      ["podborShareBp", "2000"],
      ["podborCreditDays", "30"],
      ["afterTestsRetainBp", "8500"],
      ["shelfLifeHours.components", "24"],
      ["shelfLifeHours.furniture", "72"],
    ];
    const { value, problems } = readFields(FEE_ROOT, formDataSource(fd(entries)));
    expect(problems).toEqual({});
    expect(FeeSettingsSchema.safeParse({ ...(value as object), version: "x" }).success).toBe(true);
    expect((value as { pcThreshold: number }).pcThreshold).toBe(20_000_000);
  });
});

describe("threshold form", () => {
  it("reads the alerts as a list of numbers and keeps the optional fields optional", () => {
    const { value } = readFields(
      THRESHOLD_ROOT,
      formDataSource(
        fd([
          ["annualLimit", "1000000000"],
          ["planCap", ""],
          ["alertsBp", "6000\n8000\n10000"],
          ["proportion", "without_registration_day"],
          ["registrationDate", ""],
        ]),
      ),
    );
    expect(value).toEqual({
      annualLimit: 1_000_000_000,
      alertsBp: [6000, 8000, 10000],
      proportion: "without_registration_day",
    });
    expect(ThresholdSettingsSchema.safeParse(value).success).toBe(true);
  });
});

describe("calendar form", () => {
  it("shows the work week as seven day boxes and the holidays as lines", () => {
    expect(CALENDAR_FIELDS.map((f) => f.key)).toEqual(["workdays", "from", "to", "holidays"]);
    expect(CALENDAR_FIELDS[0]?.options?.map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    const values = calendarToValues({
      tz: "Asia/Tashkent",
      workdays: [1, 2],
      from: "10:00",
      to: "19:00",
      holidays: ["2026-12-31", "2027-01-01"],
    });
    expect(values).toEqual({ workdays: [1, 2], from: "10:00", to: "19:00", holidays: "2026-12-31\n2027-01-01" });
  });

  it("reads days, hours and holidays into the stored shape", () => {
    const r = calendarFromForm(
      formDataSource(
        fd([
          ["workdays.__present", "1"],
          ["workdays", "1"],
          ["workdays", "2"],
          ["workdays", "6"],
          ["from", "09:00"],
          ["to", "18:00"],
          ["holidays", "31.12.2026\n2027-01-01"],
        ]),
      ),
    );
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      tz: "Asia/Tashkent",
      workdays: [1, 2, 6],
      from: "09:00",
      to: "18:00",
      holidays: ["2026-12-31", "2027-01-01"],
    });
    expect(CalendarSettingsSchema.safeParse(r.value).success).toBe(true);
  });

  it("names the bad holiday", () => {
    const r = calendarFromForm(
      formDataSource(
        fd([
          ["workdays", "1"],
          ["from", "10:00"],
          ["to", "19:00"],
          ["holidays", "31.02.2026"],
        ]),
      ),
    );
    expect(r.errors).toEqual({ holidays: "Не дата: 31.02.2026." });
  });
});

describe("flags form", () => {
  it("one yes/no per flag, keyed without dots", () => {
    expect(FLAG_FIELDS.map((f) => f.key)).toEqual(["ai", "setupConfigurator", "scene", "miniApp"]);
    expect(
      flagsToValues({
        "feature.ai": { value: true, version: 2 },
        "feature.scene": { value: false, version: 0 },
      } as never),
    ).toMatchObject({ ai: true, scene: false });
    expect(
      flagsFromForm(
        formDataSource(
          fd([
            ["ai", "true"],
            ["setupConfigurator", "false"],
            ["scene", "false"],
            ["miniApp", "true"],
          ]),
        ),
      ),
    ).toEqual({
      "feature.ai": true,
      "feature.setupConfigurator": false,
      "feature.scene": false,
      "feature.miniApp": true,
    });
  });
});
