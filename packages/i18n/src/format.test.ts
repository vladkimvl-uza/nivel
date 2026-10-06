import { describe, expect, it } from "vitest";
import { formatDate, formatSum, formatTime } from "./format.ts";

const NBSP = " ";

/** Small deterministic PRNG (mulberry32): property-style tests without extra dependencies and without flakiness. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("formatSum", () => {
  it("formats the reference sum from ARCHITECTURE 5.2 with non-breaking spaces", () => {
    expect(formatSum(12_500_000, "uz")).toBe(`12${NBSP}500${NBSP}000${NBSP}soʻm`);
  });

  it("uses the Uzbek unit with U+02BB and the Russian unit", () => {
    expect(formatSum(1000, "uz")).toContain("soʻm");
    expect(formatSum(1000, "ru")).toBe(`1${NBSP}000${NBSP}сум`);
  });

  it.each([
    [0, "0"],
    [7, "7"],
    [999, "999"],
    [1000, "1 000"],
    [12_345, "12 345"],
    [100_000, "100 000"],
    [6_700_000, "6 700 000"],
    [20_000_000, "20 000 000"],
    [29_900_000, "29 900 000"],
    [1_000_000_000, "1 000 000 000"],
    [Number.MAX_SAFE_INTEGER, "9 007 199 254 740 991"],
  ])("formats %i as %s", (n, digits) => {
    expect(formatSum(n, "uz")).toBe(`${digits.replaceAll(" ", NBSP)}${NBSP}soʻm`);
  });

  it("writes negative sums (refund entries) with the true minus sign", () => {
    expect(formatSum(-1_500, "ru")).toBe(`−1${NBSP}500${NBSP}сум`);
  });

  it("never prints negative zero", () => {
    expect(formatSum(-0, "uz")).toBe(`0${NBSP}soʻm`);
  });

  it.each([
    ["fraction", 0.5],
    ["fractional tiyin", 12_500_000.25],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", 2 ** 53],
    ["negative unsafe integer", -(2 ** 53)],
  ])("rejects %s: money is whole sums only", (_name, value) => {
    expect(() => formatSum(value, "uz")).toThrow(RangeError);
  });

  it("rejects values that are not numbers", () => {
    expect(() => formatSum("100" as unknown as number, "uz")).toThrow(TypeError);
    expect(() => formatSum(null as unknown as number, "uz")).toThrow(TypeError);
    expect(() => formatSum(undefined as unknown as number, "uz")).toThrow(TypeError);
    expect(() => formatSum(10n as unknown as number, "uz")).toThrow(TypeError);
  });

  it("rejects an unknown locale", () => {
    expect(() => formatSum(1, "en" as never)).toThrow(TypeError);
  });

  it("has no currency parameter: sums are always in so'm", () => {
    // @ts-expect-error the function does not accept another currency
    expect(formatSum(1000, "uz", "USD")).toBe(`1${NBSP}000${NBSP}soʻm`);
  });

  it("property: digits round-trip, groups of three, one unit, no dollars (2000 random sums)", () => {
    const rnd = prng(20261006);
    for (let i = 0; i < 2000; i++) {
      const magnitude = 10 ** Math.floor(rnd() * 16);
      const n = Math.floor(rnd() * magnitude) * (rnd() < 0.2 ? -1 : 1);
      for (const locale of ["uz", "ru"] as const) {
        const out = formatSum(n, locale);
        const unit = locale === "uz" ? "soʻm" : "сум";
        expect(out.endsWith(`${NBSP}${unit}`)).toBe(true);
        const body = out.slice(0, -(unit.length + 1)).replace("−", "-");
        const groups = body.replace("-", "").split(NBSP);
        expect(groups[0]?.length).toBeLessThanOrEqual(3);
        for (const g of groups.slice(1)) expect(g).toHaveLength(3);
        expect(Number(body.replaceAll(NBSP, ""))).toBe(n === 0 ? 0 : n);
        expect(out).not.toMatch(/[$.,]|USD/);
      }
    }
  });
});

describe("formatDate", () => {
  it("formats a date in Asia/Tashkent as dd.mm.yyyy", () => {
    expect(formatDate("2026-11-02T09:00:00+05:00", "uz")).toBe("02.11.2026");
    expect(formatDate("2026-11-02T09:00:00+05:00", "ru")).toBe("02.11.2026");
  });

  it("moves the calendar day across midnight: 19:30 UTC is already the next day in Tashkent", () => {
    expect(formatDate("2026-10-06T19:30:00Z", "uz")).toBe("07.10.2026");
    expect(formatDate("2026-10-06T18:59:59Z", "uz")).toBe("06.10.2026");
  });

  it("accepts a Date object", () => {
    expect(formatDate(new Date(Date.UTC(2026, 11, 31, 20, 0, 0)), "uz")).toBe("01.01.2027");
  });

  it("takes a plain IsoDate as is, without a time zone shift", () => {
    expect(formatDate("2026-10-05", "uz")).toBe("05.10.2026");
    expect(formatDate("2024-02-29", "ru")).toBe("29.02.2024");
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "26-10-05",
    "05.10.2026",
    "",
    "not a date",
    "2026-10-05T10:00:00",
  ])("rejects %j (invalid or without an explicit offset)", (value) => {
    expect(() => formatDate(value, "uz")).toThrow(RangeError);
  });

  it.each([
    "2026-02-30T10:00:00+05:00",
    "2026-04-31T10:00:00Z",
    "2026-10-05T24:00:00Z",
    "2026-10-05T10:60:00Z",
    "2026-10-05T10:00:60Z",
    "2026-10-05T10:00:00+24:00",
    "2026-10-05T10:00:00+05:60",
  ])("rejects the impossible timestamp %s instead of rolling it over", (value) => {
    expect(() => formatDate(value, "uz")).toThrow(RangeError);
    expect(() => formatTime(value, "uz")).toThrow(RangeError);
  });

  it("still accepts the last real second of a leap-day timestamp", () => {
    expect(formatDate("2028-02-29T23:59:59+05:00", "uz")).toBe("29.02.2028");
    expect(formatTime("2028-02-29T23:59:59+05:00", "uz")).toBe("23:59");
  });

  it("rejects an invalid Date and non-date values", () => {
    expect(() => formatDate(new Date(Number.NaN), "uz")).toThrow(RangeError);
    expect(() => formatDate(123 as unknown as string, "uz")).toThrow(TypeError);
    expect(() => formatDate("2026-10-05", "de" as never)).toThrow(TypeError);
  });
});

describe("formatTime", () => {
  it("formats 24-hour time in Asia/Tashkent", () => {
    expect(formatTime("2026-11-02T14:30:00+05:00", "uz")).toBe("14:30");
    expect(formatTime("2026-11-02T09:30:00Z", "ru")).toBe("14:30");
  });

  it("pads hours and handles midnight as 00:xx, never 24:xx", () => {
    expect(formatTime("2026-10-06T19:05:00Z", "uz")).toBe("00:05");
    expect(formatTime("2026-10-06T04:07:00+05:00", "uz")).toBe("04:07");
  });

  it("accepts a Date object", () => {
    expect(formatTime(new Date(Date.UTC(2026, 9, 6, 7, 0, 0)), "uz")).toBe("12:00");
  });

  it("rejects a date without time and invalid values", () => {
    expect(() => formatTime("2026-10-05", "uz")).toThrow(RangeError);
    expect(() => formatTime("garbage", "uz")).toThrow(RangeError);
    expect(() => formatTime(new Date(Number.NaN), "uz")).toThrow(RangeError);
  });
});
