import { createWorkCalendar } from "@nivel/domain/calendar";
import { describe, expect, it } from "vitest";
import { nextOpening } from "./hours.ts";

const cal = createWorkCalendar(["2026-10-13"], { from: "10:00", to: "19:00" });
const at = (iso: string) => new Date(iso);

describe("nextOpening: when the owner answers next", () => {
  it("inside the hours it is now", () => {
    const now = at("2026-10-12T11:30:00+05:00");
    expect(nextOpening(cal, now).getTime()).toBe(now.getTime());
  });

  it("before the opening of a working day it is that morning", () => {
    expect(nextOpening(cal, at("2026-10-14T08:30:00+05:00")).toISOString()).toBe(
      at("2026-10-14T10:00:00+05:00").toISOString(),
    );
  });

  it("after the closing it is the next working day", () => {
    expect(nextOpening(cal, at("2026-10-12T19:00:00+05:00")).toISOString()).toBe(
      at("2026-10-14T10:00:00+05:00").toISOString(),
    );
  });

  it("on Sunday it is Monday, and a holiday is skipped", () => {
    expect(nextOpening(cal, at("2026-10-11T22:00:00+05:00")).toISOString()).toBe(
      at("2026-10-12T10:00:00+05:00").toISOString(),
    );
    // Tuesday 13 October is a holiday here: from Monday evening the answer comes on Wednesday.
    expect(nextOpening(cal, at("2026-10-12T20:00:00+05:00")).toISOString()).toBe(
      at("2026-10-14T10:00:00+05:00").toISOString(),
    );
  });

  it("keeps the exact minute of the opening when asked a minute before it", () => {
    expect(nextOpening(cal, at("2026-10-14T09:59:30+05:00")).toISOString()).toBe(
      at("2026-10-14T10:00:00+05:00").toISOString(),
    );
  });

  it("finds the opening after a long run of holidays", () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    const long = createWorkCalendar(days(30), { from: "10:00", to: "19:00" });
    expect(nextOpening(long, at("2026-10-12T10:00:00+05:00")).toISOString()).toBe(
      at("2026-10-31T10:00:00+05:00").toISOString(),
    );
  });

  it("gives up after three weeks without a working hour and answers the instant it stopped at", () => {
    const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    const closed = createWorkCalendar(days, { from: "10:00", to: "19:00" });
    const from = at("2026-10-12T10:00:00+05:00");
    const end = nextOpening(closed, from);
    expect(closed.isResponseHours(end)).toBe(false);
    expect(end.getTime() - from.getTime()).toBeGreaterThanOrEqual(21 * 24 * 3_600_000);
  });
});
