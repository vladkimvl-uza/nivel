import { describe, expect, it } from "vitest";
import { formatBp, formatDate, formatDateTime, formatSum, tashkentDay } from "./format.ts";

describe("formatSum", () => {
  it("groups by three with non-breaking spaces and names the unit", () => {
    expect(formatSum(12_500_000)).toBe("12\u00a0500\u00a0000\u00a0сум");
    expect(formatSum(0)).toBe("0\u00a0сум");
    expect(formatSum(999)).toBe("999\u00a0сум");
    expect(formatSum(1_000)).toBe("1\u00a0000\u00a0сум");
  });
  it("writes a negative sum with a proper minus", () => {
    expect(formatSum(-150_000)).toBe("−150\u00a0000\u00a0сум");
  });
  it("shows a dash for a missing sum and refuses a fraction", () => {
    expect(formatSum(null)).toBe("—");
    expect(formatSum(undefined)).toBe("—");
    expect(() => formatSum(1.5)).toThrow(RangeError);
  });
});

describe("formatBp", () => {
  it("turns basis points into percent without floats", () => {
    expect(formatBp(1500)).toBe("15 %");
    expect(formatBp(10_000)).toBe("100 %");
    expect(formatBp(6_050)).toBe("60,5 %");
    expect(formatBp(5)).toBe("0,05 %");
    expect(formatBp(0)).toBe("0 %");
  });
});

describe("dates in Tashkent", () => {
  it("shows the wall clock of Asia/Tashkent", () => {
    const at = new Date("2026-10-12T05:30:00Z");
    expect(formatDateTime(at)).toBe("12.10.2026 10:30");
    expect(formatDate(at)).toBe("12.10.2026");
    expect(tashkentDay(new Date("2026-10-12T20:00:00Z"))).toBe("2026-10-13");
  });
  it("shows a dash for a missing date", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
  it("reads a day written 2026-10-12", () => {
    expect(formatDate("2026-10-12")).toBe("12.10.2026");
  });
});

describe("toTashkentLocal", () => {
  it("writes a moment as the value of a datetime-local field, and parseTashkentLocal reads it back", async () => {
    const { toTashkentLocal } = await import("./format.ts");
    const { parseTashkentLocal } = await import("./build-event.ts");
    const at = new Date("2026-10-12T10:30:00Z");
    expect(toTashkentLocal(at)).toBe("2026-10-12T15:30");
    expect(parseTashkentLocal(toTashkentLocal(at))?.toISOString()).toBe("2026-10-12T10:30:00.000Z");
  });
});
