import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Bp, bp, type Sum, sum } from "../money/index.ts";
import {
  DEFAULT_THRESHOLD_SETTINGS,
  type DealEntry,
  type ThresholdSettings,
  thresholdForYear,
  thresholdStatus,
} from "./index.ts";

const S = sum;
const settings = (over: Partial<ThresholdSettings> = {}): ThresholdSettings => ({
  ...DEFAULT_THRESHOLD_SETTINGS,
  ...over,
});
const entry = (kind: DealEntry["kind"], amount: number, date = "2026-10-20"): DealEntry => ({
  kind,
  amount: S(amount),
  date,
});

describe("thresholdForYear: proportional threshold of the registration year (NK art. 462 part 8)", () => {
  // registration date, proportion, expected limit
  it.each([
    ["2026-10-15", "without_registration_day", 210_958_904],
    ["2026-10-15", "with_registration_day", 213_698_630],
    ["2026-11-01", "without_registration_day", 164_383_561],
    ["2026-11-01", "with_registration_day", 167_123_287],
  ] as const)("registered %s (%s) -> %i", (registrationDate, proportion, expected) => {
    expect(thresholdForYear(2026, settings({ registrationDate, proportion }))).toBe(expected);
  });

  it("defaults to the lower bound: the registration day is not counted", () => {
    expect(thresholdForYear(2026, settings({ registrationDate: "2026-10-15" }))).toBe(210_958_904);
  });

  it("is the full annual limit in other years and without a registration date", () => {
    expect(thresholdForYear(2027, settings({ registrationDate: "2026-10-15" }))).toBe(1_000_000_000);
    expect(thresholdForYear(2025, settings({ registrationDate: "2026-10-15" }))).toBe(1_000_000_000);
    expect(thresholdForYear(2026, settings())).toBe(1_000_000_000);
  });

  it("counts 366 days in a leap year", () => {
    // 2028-03-01 is day 61 of 366: 305 days left
    expect(thresholdForYear(2028, settings({ registrationDate: "2028-03-01" }))).toBe(833_333_333);
    expect(
      thresholdForYear(2028, settings({ registrationDate: "2028-03-01", proportion: "with_registration_day" })),
    ).toBe(
      836_065_573, // 306 / 366
    );
  });

  it("handles the first and the last day of the year", () => {
    expect(thresholdForYear(2026, settings({ registrationDate: "2026-01-01" }))).toBe(997_260_273); // 364 / 365
    expect(
      thresholdForYear(2026, settings({ registrationDate: "2026-01-01", proportion: "with_registration_day" })),
    ).toBe(1_000_000_000);
    expect(thresholdForYear(2026, settings({ registrationDate: "2026-12-31" }))).toBe(0);
    expect(
      thresholdForYear(2026, settings({ registrationDate: "2026-12-31", proportion: "with_registration_day" })),
    ).toBe(2_739_726);
  });

  it("follows the configured annual limit", () => {
    expect(thresholdForYear(2026, settings({ annualLimit: S(5_280_000_000) }))).toBe(5_280_000_000);
  });

  it.each(["", "2026-13-01", "2026-02-30", "26-10-15", "2026-10-15T00:00:00Z", "15.10.2026"])(
    "rejects registration date %j",
    (registrationDate) => {
      expect(() => thresholdForYear(2026, settings({ registrationDate }))).toThrow(RangeError);
    },
  );
  it("rejects a year that is not a whole number", () => {
    expect(() => thresholdForYear(2026.5, settings())).toThrow(RangeError);
  });
});

describe("thresholdStatus", () => {
  const reg = settings({ registrationDate: "2026-10-15" });

  it("sums receipts, fees received and other income, minus fee refunds", () => {
    const st = thresholdStatus(
      [
        entry("receipt", 100_000_000),
        entry("fee_in", 10_000_000),
        entry("other_income", 5_000_000),
        entry("fee_refund", 2_000_000),
      ],
      S(0),
      2026,
      reg,
    );
    expect(st).toMatchObject({
      year: 2026,
      limit: 210_958_904,
      volume: 113_000_000,
      committed: 0,
      shareBp: 5356,
      projectedShareBp: 5356,
      crossedAlerts: [],
      overPlanCap: false,
      remaining: 97_958_904,
    });
  });

  it("includes committed estimates in the projection and the remainder", () => {
    const st = thresholdStatus([entry("receipt", 113_000_000)], S(20_000_000), 2026, reg);
    expect(st.shareBp).toBe(5356);
    expect(st.projectedShareBp).toBe(6304); // 133 / 210.958904
    expect(st.remaining).toBe(210_958_904 - 133_000_000);
  });

  it("only entries of the requested year count", () => {
    const st = thresholdStatus(
      [
        entry("receipt", 7_000_000, "2025-12-31"),
        entry("receipt", 3_000_000, "2026-01-01"),
        entry("receipt", 1, "2027-01-01"),
      ],
      S(0),
      2026,
      settings(),
    );
    expect(st.volume).toBe(3_000_000);
  });

  it("reports the alerts crossed by the actual volume, ascending", () => {
    const alerts = settings().alertsBp;
    expect(alerts).toEqual([6000, 7000, 8000, 9000, 10_000]);
    const at = (volume: number) => thresholdStatus([entry("receipt", volume)], S(0), 2026, settings()).crossedAlerts;
    expect(at(599_999_999)).toEqual([]);
    expect(at(600_000_000)).toEqual([6000]);
    expect(at(790_000_000)).toEqual([6000, 7000]);
    expect(at(900_000_000)).toEqual([6000, 7000, 8000, 9000]);
    expect(at(1_000_000_000)).toEqual([6000, 7000, 8000, 9000, 10_000]);
  });

  it("takes a read-only list of alerts without a cast and does not change it (WP-00, ADR-007 item 1)", () => {
    const alerts: readonly Bp[] = Object.freeze([bp(9000), bp(6000)]);
    const s: ThresholdSettings = settings({ alertsBp: alerts });
    expect(thresholdStatus([entry("receipt", 950_000_000)], S(0), 2026, s).crossedAlerts).toEqual([6000, 9000]);
    expect(alerts).toEqual([9000, 6000]);
    // @ts-expect-error the list in the contract is read-only
    expect(() => s.alertsBp.push(bp(1))).toThrow(TypeError);
  });

  it("sorts and de-duplicates configured alerts", () => {
    const s = settings({ alertsBp: [bp(9000), bp(6000), bp(9000), bp(7000)] });
    const st = thresholdStatus([entry("receipt", 950_000_000)], S(0), 2026, s);
    expect(st.crossedAlerts).toEqual([6000, 7000, 9000]);
  });

  it("past the limit: shares stop at 100 %, nothing remains", () => {
    const st = thresholdStatus([entry("receipt", 1_300_000_000)], S(50_000_000), 2026, settings());
    expect(st).toMatchObject({ shareBp: 10_000, projectedShareBp: 10_000, remaining: 0 });
    expect(st.crossedAlerts).toContain(10_000);
  });

  it("plan cap: projection above the plan is flagged, equal is not", () => {
    const s = settings({ planCap: S(200_000_000) });
    const flag = (volume: number, committed: number) =>
      thresholdStatus([entry("receipt", volume)], S(committed), 2026, s).overPlanCap;
    expect(flag(150_000_000, 50_000_000)).toBe(false);
    expect(flag(150_000_000, 50_000_001)).toBe(true);
    expect(flag(200_000_001, 0)).toBe(true);
    expect(thresholdStatus([entry("receipt", 9_999_999_999)], S(0), 2026, settings()).overPlanCap).toBe(false);
  });

  it("a zero limit (registration on 31 December without the day) is already exhausted by any deal", () => {
    const s = settings({ registrationDate: "2026-12-31" });
    expect(thresholdStatus([], S(0), 2026, s)).toMatchObject({
      limit: 0,
      shareBp: 0,
      projectedShareBp: 0,
      remaining: 0,
    });
    expect(thresholdStatus([entry("receipt", 1, "2026-12-31")], S(0), 2026, s)).toMatchObject({
      shareBp: 10_000,
      projectedShareBp: 10_000,
    });
    expect(thresholdStatus([], S(5), 2026, s).projectedShareBp).toBe(10_000);
  });

  it("an empty year is all zeros", () => {
    expect(thresholdStatus([], S(0), 2026, settings())).toEqual({
      year: 2026,
      limit: 1_000_000_000,
      volume: 0,
      committed: 0,
      shareBp: 0,
      projectedShareBp: 0,
      crossedAlerts: [],
      overPlanCap: false,
      remaining: 1_000_000_000,
    });
  });

  it("rejects malformed entry dates and amounts", () => {
    expect(() => thresholdStatus([entry("receipt", 1, "2026-10-32")], S(0), 2026, settings())).toThrow(RangeError);
    expect(() => thresholdStatus([entry("receipt", 1, "yesterday")], S(0), 2026, settings())).toThrow(RangeError);
    expect(() =>
      thresholdStatus([{ kind: "receipt", amount: 1.5 as unknown as Sum, date: "2026-10-20" }], S(0), 2026, settings()),
    ).toThrow(RangeError);
  });

  it("rejects an unknown entry kind", () => {
    expect(() =>
      thresholdStatus(
        [{ kind: "gift" as DealEntry["kind"], amount: S(1), date: "2026-10-20" }],
        S(0),
        2026,
        settings(),
      ),
    ).toThrow(RangeError);
  });

  it("property: the order of entries does not matter, and a receipt never lowers the share", () => {
    const kinds = ["receipt", "fee_in", "fee_refund", "other_income"] as const;
    const row = fc.record({ kind: fc.constantFrom(...kinds), amount: fc.integer({ min: 0, max: 90_000_000 }) });
    // The entries and the same entries in another order.
    const entriesAndPermutation = fc
      .array(row, { maxLength: 10 })
      .chain((rows) =>
        fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length })),
      );
    fc.assert(
      fc.property(entriesAndPermutation, fc.integer({ min: 0, max: 50_000_000 }), ([rows, permuted], extra) => {
        const entries = rows.map((r) => entry(r.kind, r.amount));
        const shuffled = permuted.map((r) => entry(r.kind, r.amount));
        const a = thresholdStatus(entries, S(0), 2026, reg);
        const b = thresholdStatus(shuffled, S(0), 2026, reg);
        expect(b).toEqual(a);
        const more = thresholdStatus([...entries, entry("receipt", extra)], S(0), 2026, reg);
        expect(more.shareBp).toBeGreaterThanOrEqual(a.shareBp);
        expect(more.crossedAlerts.length).toBeGreaterThanOrEqual(a.crossedAlerts.length);
      }),
      { numRuns: 500 },
    );
  });
});
