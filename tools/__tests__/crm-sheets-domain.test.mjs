// Threshold, reserves, cancellation and calendar of the Apps Script code against the functions of packages/domain,
// on tables of cases and on pseudo-random money.
import { beforeAll, describe, expect, it } from "vitest";
import { addMonthsTashkent, createWorkCalendar } from "../../packages/domain/src/calendar/index.ts";
import { settleCancellation } from "../../packages/domain/src/cancel/index.ts";
import { DEFAULT_FEE_SETTINGS as S } from "../../packages/domain/src/fee/index.ts";
import { applyBp, bp, splitByShares, sum } from "../../packages/domain/src/money/index.ts";
import { taxRiskReserve, warrantyReserveContribution } from "../../packages/domain/src/reserve/index.ts";
import {
  DEFAULT_THRESHOLD_SETTINGS,
  thresholdForYear,
  thresholdStatus,
} from "../../packages/domain/src/threshold/index.ts";
import { warrantyDeadlines } from "../../packages/domain/src/warranty/index.ts";
import { evalIn, loadSources } from "../crm-sheets/scripts/load.mjs";

let ctx;
const call = (fn, ...args) => {
  ctx.__args = args;
  return JSON.parse(evalIn(ctx, `JSON.stringify(${fn}(...__args))`) ?? "null");
};
const defaults = () => JSON.parse(evalIn(ctx, "JSON.stringify(nvDefaultSettings())"));

beforeAll(() => {
  ctx = loadSources();
});

let seed = 99;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

describe("rounding and shares", () => {
  it("applyBp and splitByShares are those of the domain, also for large bases", () => {
    for (const base of [0, 1, 7, 9999, 10001, 123_456_789, 999_999_999_999, 4_503_599_627_370_495]) {
      for (const rate of [0, 1, 100, 1500, 3333, 5000, 10000]) {
        for (const mode of ["floor", "ceil", "half_up"]) {
          expect(call("nvApplyBp", base, rate, mode), `${base} ${rate} ${mode}`).toBe(
            applyBp(sum(base), bp(rate), mode),
          );
        }
      }
      const parts = call("nvSplitByShares", base, [3333, 6667]);
      expect(parts).toEqual(splitByShares(sum(base), [bp(3333), bp(6667)]));
      expect(parts[0] + parts[1]).toBe(base);
    }
  });
});

describe("the annual threshold", () => {
  const settings = (reg, proportion) => ({ ...defaults(), regDate: reg || "", proportion });
  const dom = (reg, proportion) => ({
    ...DEFAULT_THRESHOLD_SETTINGS,
    registrationDate: reg || undefined,
    proportion: proportion === "С днём регистрации" ? "with_registration_day" : "without_registration_day",
  });

  it("the limit of the year equals the domain for every week of a year (leap and not) in both proportions", () => {
    for (const year of [2026, 2028]) {
      for (let day = 0; day < (year === 2028 ? 366 : 365); day += 7) {
        const d = new Date(Date.UTC(year, 0, 1 + day)).toISOString().slice(0, 10);
        for (const proportion of ["Без дня регистрации", "С днём регистрации"]) {
          expect(call("nvThresholdForYear", year, settings(d, proportion)), `${d} ${proportion}`).toBe(
            thresholdForYear(year, dom(d, proportion)),
          );
        }
      }
    }
    expect(call("nvThresholdForYear", 2027, settings("2026-10-15", "Без дня регистрации"))).toBe(1_000_000_000);
    expect(call("nvThresholdForYear", 2026, settings("", "Без дня регистрации"))).toBe(1_000_000_000);
  });

  it("the documented values of the owner's documents", () => {
    expect(call("nvThresholdForYear", 2026, settings("2026-10-15", "Без дня регистрации"))).toBe(210_958_904);
    expect(call("nvThresholdForYear", 2026, settings("2026-10-15", "С днём регистрации"))).toBe(213_698_630);
    expect(call("nvThresholdForYear", 2026, settings("2026-11-01", "Без дня регистрации"))).toBe(164_383_561);
    expect(call("nvThresholdForYear", 2026, settings("2026-11-01", "С днём регистрации"))).toBe(167_123_287);
  });

  it("the status (volume, shares, alerts, plan, remainder) equals the domain on random entries", () => {
    for (let i = 0; i < 300; i++) {
      const entries = [];
      for (let k = 0; k < 1 + Math.floor(rnd() * 12); k++) {
        const kind = pick(["receipt", "fee_in", "fee_refund", "other_income"]);
        const year = pick([2025, 2026, 2026, 2026, 2027]);
        const month = String(1 + Math.floor(rnd() * 12)).padStart(2, "0");
        const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
        entries.push({ kind, amount: Math.floor(rnd() * 90_000_000), date: `${year}-${month}-${day}` });
      }
      const committed = Math.floor(rnd() * 50_000_000);
      const reg = rnd() < 0.5 ? "2026-10-15" : "";
      const proportion = pick(["Без дня регистрации", "С днём регистрации"]);
      const mine = call("nvThresholdStatus", entries, committed, 2026, {
        ...settings(reg, proportion),
        planCap2026: 200_000_000,
      });
      const d = thresholdStatus(
        entries.map((e) => ({ ...e, amount: sum(e.amount) })),
        sum(committed),
        2026,
        { ...dom(reg, proportion), planCap: sum(200_000_000) },
      );
      expect(mine.limit).toBe(d.limit);
      expect(mine.volume).toBe(d.volume);
      expect(mine.shareBp).toBe(d.shareBp);
      expect(mine.projectedShareBp).toBe(d.projectedShareBp);
      expect(mine.crossedAlerts).toEqual(d.crossedAlerts);
      expect(mine.overPlanCap).toBe(d.overPlanCap);
      expect(mine.remaining).toBe(d.remaining);
    }
  });

  it("a return of the fee lowers the volume; a return of the reserve is not a deal (it is not an entry at all)", () => {
    const s = { ...settings("", "Без дня регистрации"), planCap2026: 200_000_000 };
    const r = call(
      "nvThresholdStatus",
      [
        { kind: "fee_in", amount: 1_000_000, date: "2026-03-01" },
        { kind: "fee_refund", amount: 400_000, date: "2026-03-02" },
      ],
      0,
      2026,
      s,
    );
    expect(r.volume).toBe(600_000);
    expect(() =>
      call("nvThresholdStatus", [{ kind: "reserve_back", amount: 1, date: "2026-03-01" }], 0, 2026, s),
    ).toThrow();
  });
});

describe("reserves", () => {
  it("the warranty contribution equals the domain around every boundary of a mature fund", () => {
    const s = defaults();
    for (const base of [0, 1, 1_000_000, 7_499_999, 7_500_000, 10_000_000, 33_333_333]) {
      for (const balance of [0, 9_999_999, 10_000_000, 50_000_000]) {
        for (const closedOrders of [0, 29, 30, 100]) {
          for (const lossesBp of [0, 49, 50, 300]) {
            const mine = call("nvWarrantyContribution", base, { balance, closedOrders, lossesBp }, s);
            expect(mine, `${base} ${balance} ${closedOrders} ${lossesBp}`).toBe(
              warrantyReserveContribution(sum(base), {
                balance: sum(balance),
                closedOrders,
                lossesLast12mBp: bp(lossesBp),
              }),
            );
          }
        }
      }
    }
    expect(call("nvWarrantyContribution", 1_000_000, { balance: 0, closedOrders: 0, lossesBp: 0 }, s)).toBe(150_000);
    expect(call("nvWarrantyContribution", 10_000_000, { balance: 0, closedOrders: 0, lossesBp: 0 }, s)).toBe(200_000);
  });

  it("refuses a lost fund state instead of guessing", () => {
    const s = defaults();
    expect(() => call("nvWarrantyContribution", 1_000_000, null, s)).toThrow();
    expect(() => call("nvWarrantyContribution", 1_000_000, { balance: 0, closedOrders: -1, lossesBp: 0 }, s)).toThrow();
  });

  it("the tax-risk reserve equals the domain; a lost flag is an error, not a quiet zero", () => {
    const s = defaults();
    for (const total of [0, 1, 99, 100, 101, 12_345_678, 999_999_999]) {
      expect(call("nvTaxRiskReserve", total, true, s)).toBe(taxRiskReserve(sum(total), true));
      expect(call("nvTaxRiskReserve", total, false, s)).toBe(0);
    }
    expect(() => call("nvTaxRiskReserve", 100, undefined, s)).toThrow();
  });

  it("the turnover tax is 1 % of the fee, up", () => {
    const s = defaults();
    expect(call("nvTurnoverTax", 3_260_000, s)).toBe(32_600);
    expect(call("nvTurnoverTax", 3_260_001, s)).toBe(32_601);
    expect(call("nvTurnoverTax", -5, s)).toBe(0);
  });
});

describe("calendar", () => {
  const holidays = ["2026-10-13", "2026-11-02"];
  const cal = createWorkCalendar(holidays, { from: "10:00", to: "19:00" });
  const t = (iso) => new Date(iso).getTime();

  it("working days: Monday to Saturday minus holidays, time of the day kept (addWorkingDays of the domain)", () => {
    for (let i = 0; i < 200; i++) {
      const start = new Date(Date.parse("2026-10-01T00:00:00+05:00") + Math.floor(rnd() * 60 * 86_400_000));
      const n = Math.floor(rnd() * 12);
      expect(new Date(call("nvAddWorkingDays", start, n, holidays)).getTime()).toBe(
        cal.addWorkingDays(start, n).getTime(),
      );
      expect(new Date(call("nvNextWorkingDayStart", start, holidays, 600)).getTime()).toBe(
        cal.nextWorkingDayStart(start).getTime(),
      );
      expect(call("nvIsResponseHours", start, holidays, "10:00", "19:00")).toBe(cal.isResponseHours(start));
    }
  });

  it("money received on Monday allows a purchase from Tuesday 10:00; around a holiday and a Sunday the next working day", () => {
    const next = (iso) => new Date(call("nvNextWorkingDayStart", new Date(iso), holidays)).getTime();
    expect(next("2026-10-05T16:00:00+05:00")).toBe(t("2026-10-06T10:00:00+05:00"));
    expect(next("2026-10-12T16:00:00+05:00")).toBe(t("2026-10-14T10:00:00+05:00"));
    expect(next("2026-10-10T16:00:00+05:00")).toBe(t("2026-10-12T10:00:00+05:00"));
  });

  it("twelve months from 29.02.2028 is 28.02.2029 (the last day of a shorter month)", () => {
    for (const iso of ["2028-02-29T12:00:00+05:00", "2026-01-31T09:30:00+05:00", "2026-10-06T23:59:00+05:00"]) {
      for (const n of [1, 12, 13]) {
        expect(new Date(call("nvAddMonths", new Date(iso), n)).getTime()).toBe(
          addMonthsTashkent(new Date(iso), n).getTime(),
        );
      }
    }
  });

  it("the deadlines of a warranty case are those of the domain", () => {
    for (let i = 0; i < 60; i++) {
      const opened = new Date(Date.parse("2026-10-01T09:00:00+05:00") + Math.floor(rnd() * 40 * 86_400_000));
      const mine = call("nvWarrantyDeadlines", opened, holidays);
      const d = warrantyDeadlines(opened, cal);
      expect(new Date(mine.reply).getTime()).toBe(d.reply.getTime());
      expect(new Date(mine.diagnosis).getTime()).toBe(d.diagnosis.getTime());
      expect(new Date(mine.loaner).getTime()).toBe(d.loaner.getTime());
      expect(new Date(mine.fixWork).getTime()).toBe(d.fixWork.getTime());
      expect(new Date(mine.fixParts).getTime()).toBe(d.fixParts.getTime());
    }
  });

  it("the working hours of the response time count only the window 10:00-19:00 of working days", () => {
    const h = (a, b) => call("nvWorkingHoursBetween", new Date(a), new Date(b), holidays, "10:00", "19:00");
    expect(h("2026-10-07T09:00:00+05:00", "2026-10-07T12:30:00+05:00")).toBe(2.5);
    expect(h("2026-10-07T18:00:00+05:00", "2026-10-08T11:00:00+05:00")).toBe(2);
    expect(h("2026-10-10T18:00:00+05:00", "2026-10-12T11:00:00+05:00")).toBe(2);
    expect(h("2026-10-12T12:00:00+05:00", "2026-10-14T10:00:00+05:00")).toBe(7);
    expect(h("2026-10-07T12:00:00+05:00", "2026-10-07T11:00:00+05:00")).toBe(0);
  });
});

describe("cancellation", () => {
  const cal = createWorkCalendar([], { from: "10:00", to: "19:00" });
  const points = [
    "before_accept",
    "after_accept_before_purchase",
    "after_purchase_before_assembly",
    "during_assembly",
    "after_tests_before_handover",
  ];
  it("the settlement equals settleCancellation on random money for every point", () => {
    const s = defaults();
    for (let i = 0; i < 400; i++) {
      const point = pick(points);
      const fee = Math.floor(rnd() * 8_000_000);
      const feePaid = pick([0, Math.floor(fee * 0.3), fee, Math.floor(rnd() * 9_000_000)]);
      const fundsReceived = Math.floor(rnd() * 60_000_000);
      const receiptsTotal = Math.floor(rnd() * fundsReceived);
      const shopRefunds = Math.floor(rnd() * receiptsTotal);
      const afterReceipts = fundsReceived - receiptsTotal + shopRefunds;
      const documentedLosses = Math.floor(rnd() * afterReceipts);
      const assemblyDoneBp = Math.floor(rnd() * 10_001);
      const now = new Date(Date.parse("2026-10-05T12:00:00+05:00") + Math.floor(rnd() * 20 * 86_400_000));
      const input = {
        point,
        fee,
        feePaid,
        fundsReceived,
        receiptsTotal,
        shopRefunds,
        documentedLosses,
        assemblyDoneBp: point === "during_assembly" ? assemblyDoneBp : undefined,
      };
      const mine = call("nvSettleCancellation", input, s, now, []);
      const d = settleCancellation(
        {
          point,
          fee: sum(fee),
          feePaid: sum(feePaid),
          fundsReceived: sum(fundsReceived),
          receiptsTotal: sum(receiptsTotal),
          shopRefunds: sum(shopRefunds),
          documentedLosses: sum(documentedLosses),
          assemblyDoneBp: input.assemblyDoneBp === undefined ? undefined : bp(input.assemblyDoneBp),
        },
        S,
        now,
        cal,
      );
      expect(mine.feeEarned, JSON.stringify(input)).toBe(d.feeEarned);
      expect(mine.feeToRefund).toBe(d.feeToRefund);
      expect(mine.feeToInvoice).toBe(d.feeToInvoice);
      expect(mine.fundsToRefund).toBe(d.fundsToRefund);
      expect(mine.partsGoTo).toBe(d.partsGoTo);
      expect(new Date(mine.dueBy).getTime()).toBe(d.dueBy.getTime());
    }
  });

  it("the stage shares of the documents: 0, 20 %, 50 %, 50 % + done × 35 %, 85 %", () => {
    const s = defaults();
    const earn = (point, doneBp) =>
      call(
        "nvSettleCancellation",
        { point, fee: 1_000_000, feePaid: 0, fundsReceived: 0, receiptsTotal: 0, assemblyDoneBp: doneBp },
        s,
        new Date("2026-10-05T12:00:00+05:00"),
        [],
      ).feeEarned;
    expect(earn("before_accept")).toBe(0);
    expect(earn("after_accept_before_purchase")).toBe(200_000);
    expect(earn("after_purchase_before_assembly")).toBe(500_000);
    expect(earn("during_assembly", 0)).toBe(500_000);
    expect(earn("during_assembly", 10_000)).toBe(850_000);
    expect(earn("during_assembly", 5_000)).toBe(675_000);
    expect(earn("after_tests_before_handover")).toBe(850_000);
  });

  it("refuses what would exceed the money of the client or the work that was not entered", () => {
    const s = defaults();
    const base = {
      point: "during_assembly",
      fee: 1_000_000,
      feePaid: 0,
      fundsReceived: 1_000_000,
      receiptsTotal: 400_000,
      assemblyDoneBp: 1000,
    };
    const now = new Date("2026-10-05T12:00:00+05:00");
    expect(() => call("nvSettleCancellation", { ...base, assemblyDoneBp: undefined }, s, now, [])).toThrow();
    expect(() => call("nvSettleCancellation", { ...base, assemblyDoneBp: 10_001 }, s, now, [])).toThrow();
    expect(() => call("nvSettleCancellation", { ...base, receiptsTotal: 2_000_000 }, s, now, [])).toThrow();
    expect(() => call("nvSettleCancellation", { ...base, documentedLosses: 900_000 }, s, now, [])).toThrow();
    expect(() => call("nvSettleCancellation", { ...base, shopRefunds: 500_000 }, s, now, [])).toThrow();
    expect(() => call("nvSettleCancellation", { ...base, fee: -1 }, s, now, [])).toThrow();
    expect(() => call("nvSettleCancellation", { ...base, point: "never" }, s, now, [])).toThrow();
  });
});
