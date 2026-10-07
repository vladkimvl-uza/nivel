import { describe, expect, it } from "vitest";
import { parseCalendar, parseOwnerGroup } from "./settings.ts";

describe("parseOwnerGroup (ops.settings telegram.owner_group)", () => {
  it("reads the chat id as a number or as { chatId }", () => {
    expect(parseOwnerGroup(-1001234567890)).toBe(-1001234567890);
    expect(parseOwnerGroup({ chatId: -1001234567890 })).toBe(-1001234567890);
  });

  it("is null for what is not a chat id: the group is not set, and nothing is sent to a guess", () => {
    for (const bad of [null, undefined, 0, "abc", {}, { chatId: "x" }, { chatId: 1.5 }, [], true, Number.NaN]) {
      expect(parseOwnerGroup(bad)).toBeNull();
    }
  });

  it("takes a chat id that is a text of digits too (a hand-written setting)", () => {
    expect(parseOwnerGroup({ chatId: "-1001234567890" })).toBe(-1001234567890);
  });
});

describe("parseCalendar (ops.settings calendar.work)", () => {
  it("answers the response hours of the owner: Monday to Saturday 10:00-19:00 without the holidays", () => {
    const cal = parseCalendar({
      tz: "Asia/Tashkent",
      workdays: [1, 2, 3, 4, 5, 6],
      from: "10:00",
      to: "19:00",
      holidays: ["2026-10-14"],
    });
    expect(cal.isResponseHours(new Date("2026-10-12T10:00:00+05:00"))).toBe(true);
    expect(cal.isResponseHours(new Date("2026-10-12T09:59:00+05:00"))).toBe(false);
    expect(cal.isResponseHours(new Date("2026-10-12T19:00:00+05:00"))).toBe(false);
    expect(cal.isResponseHours(new Date("2026-10-11T12:00:00+05:00"))).toBe(false); // Sunday
    expect(cal.isResponseHours(new Date("2026-10-14T12:00:00+05:00"))).toBe(false); // a holiday
    expect(cal.isResponseHours(new Date("2026-10-17T12:00:00+05:00"))).toBe(true); // Saturday
  });

  it("works without a setting: the days Monday to Saturday, no holidays, 10:00-19:00 (DATA-MAP 10)", () => {
    const cal = parseCalendar(null);
    expect(cal.isResponseHours(new Date("2026-10-14T12:00:00+05:00"))).toBe(true);
    expect(cal.isResponseHours(new Date("2026-10-11T12:00:00+05:00"))).toBe(false);
  });

  it("refuses a setting that is set but broken, rather than guess the hours of the owner", () => {
    expect(() => parseCalendar({ from: "25:00", to: "19:00", holidays: [] })).toThrow(/calendar\.work/);
    expect(() => parseCalendar({ from: "10:00", to: "19:00", holidays: ["tomorrow"] })).toThrow(/calendar\.work/);
    expect(() => parseCalendar({ from: "19:00", to: "10:00", holidays: [] })).toThrow(/calendar\.work/);
    expect(() => parseCalendar("text")).toThrow(/calendar\.work/);
  });
});
