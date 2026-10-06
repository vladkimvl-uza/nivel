import { describe, expect, it } from "vitest";
import { addMonthsTashkent, createWorkCalendar, isoDateInTashkent, tashkentTime } from "./index.ts";

/** Deterministic PRNG (mulberry32); fast-check is not in the dependencies yet. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local Asia/Tashkent wall time (UTC+5, no DST) to an instant. */
const tk = (iso: string): Date => new Date(`${iso}+05:00`);
const HOURS = { from: "10:00", to: "19:00" };
// 2026-10-05 is a Monday, 2026-10-11 a Sunday. 2026-10-13 (Tuesday) is a test holiday, not a real one.
const cal = createWorkCalendar(["2026-10-13"], HOURS);
const calNoHolidays = createWorkCalendar([], HOURS);

describe("isWorkingDay: Monday to Saturday minus holidays", () => {
  it.each([
    ["2026-10-05", "Monday", true],
    ["2026-10-06", "Tuesday", true],
    ["2026-10-07", "Wednesday", true],
    ["2026-10-08", "Thursday", true],
    ["2026-10-09", "Friday", true],
    ["2026-10-10", "Saturday", true],
    ["2026-10-11", "Sunday", false],
    ["2026-10-13", "holiday on a Tuesday", false],
    ["2026-10-12", "Monday after the Sunday", true],
  ])("%s (%s) -> %s", (date, _name, expected) => {
    expect(cal.isWorkingDay(date)).toBe(expected);
  });

  it("a holiday on a Sunday changes nothing", () => {
    expect(createWorkCalendar(["2026-10-11"], HOURS).isWorkingDay("2026-10-11")).toBe(false);
  });

  it("handles leap day and year borders", () => {
    expect(calNoHolidays.isWorkingDay("2028-02-29")).toBe(true); // Tuesday
    expect(calNoHolidays.isWorkingDay("2026-12-31")).toBe(true); // Thursday
    expect(calNoHolidays.isWorkingDay("2027-01-03")).toBe(false); // Sunday
  });

  it.each(["", "2026-1-5", "2026-13-01", "2026-02-30", "05.10.2026", "2026-10-05T10:00:00Z", "abc"])(
    "rejects invalid date %j",
    (bad) => {
      expect(() => cal.isWorkingDay(bad)).toThrow(RangeError);
    },
  );
});

describe("createWorkCalendar: input validation", () => {
  it.each(["2026-02-30", "x", "2026-10-5"])("rejects an invalid holiday %j", (bad) => {
    expect(() => createWorkCalendar([bad], HOURS)).toThrow(RangeError);
  });

  it.each([
    { from: "19:00", to: "10:00" },
    { from: "10:00", to: "10:00" },
    { from: "24:00", to: "25:00" },
    { from: "10:60", to: "19:00" },
    { from: "9:00", to: "19:00" },
    { from: "10", to: "19:00" },
    { from: "10:00", to: "" },
  ])("rejects bad hours %j", (hours) => {
    expect(() => createWorkCalendar([], hours)).toThrow(RangeError);
  });

  it("does not keep a reference to the caller's holiday list", () => {
    const holidays = ["2026-10-14"];
    const c = createWorkCalendar(holidays, HOURS);
    holidays.push("2026-10-15");
    expect(c.isWorkingDay("2026-10-14")).toBe(false);
    expect(c.isWorkingDay("2026-10-15")).toBe(true);
  });
});

describe("isResponseHours: 10:00-19:00 Asia/Tashkent on working days", () => {
  it.each([
    ["2026-10-06T09:59:59", false],
    ["2026-10-06T10:00:00", true],
    ["2026-10-06T14:30:00", true],
    ["2026-10-06T18:59:59", true],
    ["2026-10-06T19:00:00", false],
    ["2026-10-06T23:00:00", false],
    ["2026-10-06T03:00:00", false],
    ["2026-10-10T12:00:00", true], // Saturday works
    ["2026-10-11T12:00:00", false], // Sunday
    ["2026-10-13T12:00:00", false], // holiday
  ])("%s -> %s", (local, expected) => {
    expect(cal.isResponseHours(tk(local))).toBe(expected);
  });

  it("uses Tashkent time, not UTC", () => {
    expect(cal.isResponseHours(new Date("2026-10-06T05:00:00Z"))).toBe(true); // 10:00 local
    expect(cal.isResponseHours(new Date("2026-10-06T04:59:00Z"))).toBe(false); // 09:59 local
    expect(cal.isResponseHours(new Date("2026-10-06T14:00:00Z"))).toBe(false); // 19:00 local
  });

  it("local date decides the day, not the UTC date", () => {
    // Sunday 23:30 UTC is already Monday 04:30 in Tashkent: a working day, but outside the hours.
    expect(cal.isResponseHours(new Date("2026-10-11T23:30:00Z"))).toBe(false);
    // Sunday 05:00 UTC is Sunday 10:00 local: inside the hours but not a working day.
    expect(cal.isResponseHours(new Date("2026-10-11T05:00:00Z"))).toBe(false);
  });

  it("respects custom hours", () => {
    const c = createWorkCalendar([], { from: "09:30", to: "18:00" });
    expect(c.isResponseHours(tk("2026-10-06T09:29:00"))).toBe(false);
    expect(c.isResponseHours(tk("2026-10-06T09:30:00"))).toBe(true);
    expect(c.isResponseHours(tk("2026-10-06T17:59:00"))).toBe(true);
    expect(c.isResponseHours(tk("2026-10-06T18:00:00"))).toBe(false);
  });

  it("rejects an invalid Date", () => {
    expect(() => cal.isResponseHours(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("addWorkingDays", () => {
  it("n = 0 returns the same instant", () => {
    const d = tk("2026-10-06T15:20:00");
    expect(cal.addWorkingDays(d, 0).getTime()).toBe(d.getTime());
  });

  it("does not mutate its argument and returns a new Date", () => {
    const d = tk("2026-10-06T15:20:00");
    const before = d.getTime();
    const out = cal.addWorkingDays(d, 2);
    expect(d.getTime()).toBe(before);
    expect(out).not.toBe(d);
  });

  it("keeps the local time of day", () => {
    expect(cal.addWorkingDays(tk("2026-10-06T15:20:00"), 1).getTime()).toBe(tk("2026-10-07T15:20:00").getTime());
  });

  it("Saturday is a working day, Sunday is skipped", () => {
    // Friday + 3: Saturday(1), Monday(2), Tuesday(3).
    expect(calNoHolidays.addWorkingDays(tk("2026-10-09T15:00:00"), 3).getTime()).toBe(
      tk("2026-10-13T15:00:00").getTime(),
    );
  });

  it("BUILD_PLAN: 3 working days of objections across a Sunday and a holiday", () => {
    // Report sent Thursday 2026-10-08: Friday(1), Saturday(2), Sunday skipped, Monday 12th is a holiday -> Tuesday(3).
    const withMondayHoliday = createWorkCalendar(["2026-10-12"], HOURS);
    expect(withMondayHoliday.addWorkingDays(tk("2026-10-08T12:00:00"), 3).getTime()).toBe(
      tk("2026-10-13T12:00:00").getTime(),
    );
    // Without that holiday the third day is Monday the 12th.
    expect(cal.addWorkingDays(tk("2026-10-08T12:00:00"), 3).getTime()).toBe(tk("2026-10-12T12:00:00").getTime());
  });

  it("holiday in the middle of the range is skipped", () => {
    // Monday 12th + 1 = Tuesday 13th is a holiday -> Wednesday 14th.
    expect(cal.addWorkingDays(tk("2026-10-12T11:00:00"), 1).getTime()).toBe(tk("2026-10-14T11:00:00").getTime());
  });

  it("two consecutive holidays and a Sunday", () => {
    const c = createWorkCalendar(["2026-10-12", "2026-10-13"], HOURS);
    expect(c.addWorkingDays(tk("2026-10-10T09:00:00"), 1).getTime()).toBe(tk("2026-10-14T09:00:00").getTime());
  });

  it("counting from a Sunday or a holiday starts with the next working day", () => {
    expect(cal.addWorkingDays(tk("2026-10-11T12:00:00"), 1).getTime()).toBe(tk("2026-10-12T12:00:00").getTime());
    expect(cal.addWorkingDays(tk("2026-10-13T12:00:00"), 1).getTime()).toBe(tk("2026-10-14T12:00:00").getTime());
  });

  it("uses the Tashkent date at the day border", () => {
    // 2026-10-09T20:00Z is Saturday 01:00 local; Saturday + 1 working day = Monday 01:00 local.
    expect(calNoHolidays.addWorkingDays(new Date("2026-10-09T20:00:00Z"), 1).getTime()).toBe(
      tk("2026-10-12T01:00:00").getTime(),
    );
    // 2026-10-11T20:00Z is Monday 01:00 local; + 1 = Tuesday 01:00 local.
    expect(calNoHolidays.addWorkingDays(new Date("2026-10-11T20:00:00Z"), 1).getTime()).toBe(
      tk("2026-10-13T01:00:00").getTime(),
    );
  });

  it("five working days for the refund deadline", () => {
    // Report sent Wednesday 2026-10-07: Thu(1), Fri(2), Sat(3), Mon(4), Tue 13th is a holiday, Wed 14th(5).
    expect(cal.addWorkingDays(tk("2026-10-07T16:00:00"), 5).getTime()).toBe(tk("2026-10-14T16:00:00").getTime());
  });

  it("works across a year border", () => {
    // Thursday 2026-12-31 + 2: Friday Jan 1 (1), Saturday Jan 2 (2); + 3 skips the Sunday to Monday Jan 4.
    expect(calNoHolidays.addWorkingDays(tk("2026-12-31T10:00:00"), 2).getTime()).toBe(
      tk("2027-01-02T10:00:00").getTime(),
    );
    expect(calNoHolidays.addWorkingDays(tk("2026-12-31T10:00:00"), 3).getTime()).toBe(
      tk("2027-01-04T10:00:00").getTime(),
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects n = %s", (n) => {
    expect(() => cal.addWorkingDays(tk("2026-10-06T10:00:00"), n)).toThrow(RangeError);
  });

  it("rejects an invalid Date", () => {
    expect(() => cal.addWorkingDays(new Date(Number.NaN), 1)).toThrow(RangeError);
  });

  it("handles large n quickly", () => {
    const started = Date.now();
    const out = calNoHolidays.addWorkingDays(tk("2026-10-06T10:00:00"), 10_000);
    expect(out.getTime()).toBeGreaterThan(tk("2026-10-06T10:00:00").getTime());
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("property: the result of n >= 1 is a working day, strictly increasing in n, exactly n working days apart", () => {
    const rng = makeRng(20261006);
    const holidays = ["2026-10-13", "2026-11-02", "2026-12-08", "2027-01-01"];
    const c = createWorkCalendar(holidays, HOURS);
    for (let i = 0; i < 300; i += 1) {
      const start = new Date(Date.UTC(2026, 9, 1) + Math.floor(rng() * 120 * 86_400_000));
      let previous = start.getTime();
      for (let n = 1; n <= 8; n += 1) {
        const out = c.addWorkingDays(start, n);
        expect(c.isWorkingDay(isoDateInTashkent(out))).toBe(true);
        expect(out.getTime()).toBeGreaterThan(previous);
        previous = out.getTime();
        // Time of day is preserved.
        expect((out.getTime() - start.getTime()) % 86_400_000).toBe(0);
        // Count the working days in (start, out].
        let count = 0;
        for (let t = start.getTime() + 86_400_000; t <= out.getTime(); t += 86_400_000) {
          if (c.isWorkingDay(isoDateInTashkent(new Date(t)))) count += 1;
        }
        expect(count).toBe(n);
      }
    }
  });
});

describe("nextWorkingDayStart: the start of the next working day", () => {
  it.each([
    ["Monday afternoon", "2026-10-05T14:00:00", "2026-10-06T10:00:00"],
    ["Monday before the opening", "2026-10-05T07:00:00", "2026-10-06T10:00:00"],
    ["Friday evening", "2026-10-09T21:00:00", "2026-10-10T10:00:00"],
    ["Saturday goes over Sunday to Monday", "2026-10-10T11:00:00", "2026-10-12T10:00:00"],
    ["Sunday", "2026-10-11T11:00:00", "2026-10-12T10:00:00"],
    ["Monday before a Tuesday holiday", "2026-10-12T15:00:00", "2026-10-14T10:00:00"],
    ["night after midnight local", "2026-10-06T03:30:00", "2026-10-07T10:00:00"],
  ])("%s", (_name, from, expected) => {
    expect(cal.nextWorkingDayStart(tk(from)).getTime()).toBe(tk(expected).getTime());
  });

  it("uses the Tashkent date, not UTC", () => {
    // 2026-10-05T22:30Z is Tuesday 03:30 local -> next working day is Wednesday 10:00 local.
    expect(cal.nextWorkingDayStart(new Date("2026-10-05T22:30:00Z")).getTime()).toBe(
      tk("2026-10-07T10:00:00").getTime(),
    );
  });

  it("starts at the configured opening time", () => {
    const c = createWorkCalendar([], { from: "09:30", to: "18:00" });
    expect(c.nextWorkingDayStart(tk("2026-10-05T14:00:00")).getTime()).toBe(tk("2026-10-06T09:30:00").getTime());
  });

  it("is strictly after the input and lands in the response hours", () => {
    const rng = makeRng(31);
    for (let i = 0; i < 300; i += 1) {
      const from = new Date(Date.UTC(2026, 9, 1) + Math.floor(rng() * 90 * 86_400_000));
      const out = cal.nextWorkingDayStart(from);
      expect(out.getTime()).toBeGreaterThan(from.getTime());
      expect(cal.isResponseHours(out)).toBe(true);
      expect(tashkentTime(out)).toEqual({ hour: 10, minute: 0 });
    }
  });

  it("rejects an invalid Date", () => {
    expect(() => cal.nextWorkingDayStart(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("Tashkent date helpers", () => {
  it("isoDateInTashkent switches the date at 19:00 UTC", () => {
    expect(isoDateInTashkent(new Date("2026-10-05T18:59:59Z"))).toBe("2026-10-05");
    expect(isoDateInTashkent(new Date("2026-10-05T19:00:00Z"))).toBe("2026-10-06");
    expect(isoDateInTashkent(new Date("2026-10-05T00:00:00Z"))).toBe("2026-10-05");
  });

  it("tashkentTime", () => {
    expect(tashkentTime(new Date("2026-10-05T05:07:59Z"))).toEqual({ hour: 10, minute: 7 });
    expect(tashkentTime(new Date("2026-10-05T19:00:00Z"))).toEqual({ hour: 0, minute: 0 });
  });

  it("addMonthsTashkent keeps the local time and clamps to the last day of the month", () => {
    expect(addMonthsTashkent(tk("2026-10-06T15:20:00"), 12).getTime()).toBe(tk("2027-10-06T15:20:00").getTime());
    expect(addMonthsTashkent(tk("2027-01-31T10:00:00"), 1).getTime()).toBe(tk("2027-02-28T10:00:00").getTime());
    expect(addMonthsTashkent(tk("2028-02-29T10:00:00"), 12).getTime()).toBe(tk("2029-02-28T10:00:00").getTime());
    expect(addMonthsTashkent(tk("2026-11-30T10:00:00"), 3).getTime()).toBe(tk("2027-02-28T10:00:00").getTime());
    expect(addMonthsTashkent(tk("2026-10-06T15:20:00"), 0).getTime()).toBe(tk("2026-10-06T15:20:00").getTime());
  });

  it("addMonthsTashkent uses the local date at the day border", () => {
    // 2026-10-31T20:00Z is 2026-11-01 01:00 local; +1 month = 2026-12-01 01:00 local.
    expect(addMonthsTashkent(new Date("2026-10-31T20:00:00Z"), 1).getTime()).toBe(tk("2026-12-01T01:00:00").getTime());
  });

  it("rejects bad input", () => {
    expect(() => addMonthsTashkent(new Date(Number.NaN), 1)).toThrow(RangeError);
    expect(() => addMonthsTashkent(tk("2026-10-06T10:00:00"), 1.5)).toThrow(RangeError);
    expect(() => addMonthsTashkent(tk("2026-10-06T10:00:00"), -1)).toThrow(RangeError);
    expect(() => tashkentTime(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => isoDateInTashkent(new Date(Number.NaN))).toThrow(RangeError);
  });
});
