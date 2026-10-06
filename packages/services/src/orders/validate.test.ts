import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors.ts";
import { asDate, assertInstant, assertText, assertUuid, assertWholeSum, isUuid } from "./validate.ts";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("validate", () => {
  it("knows an id from anything else, and never lets text into a query as an id", () => {
    expect(isUuid(uuid)).toBe(true);
    for (const bad of ["", "x", "NV-2026-0001", `${uuid}'; --`, 7, null, undefined, uuid.slice(1)]) {
      expect(isUuid(bad)).toBe(false);
    }
    expect(isUuid(uuid.toUpperCase())).toBe(true);
    expect(assertUuid(uuid, "id")).toBe(uuid);
    expect(() => assertUuid("x", "orderId")).toThrow(/orderId must be an id/);
  });

  it("checks a whole sum with its bounds named in the message", () => {
    expect(assertWholeSum(0, "x")).toBe(0);
    expect(assertWholeSum(1_000_000_000_000, "x")).toBe(1_000_000_000_000);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", null, 1_000_000_000_001]) {
      expect(() => assertWholeSum(bad, "amount")).toThrow(ValidationError);
    }
    expect(() => assertWholeSum(0, "amount", 1)).toThrow(/from 1 to/);
    expect(assertWholeSum(5, "x", 1, 5)).toBe(5);
    expect(() => assertWholeSum(6, "x", 1, 5)).toThrow(ValidationError);
  });

  it("checks a text: not blank, not longer than the limit, trimmed", () => {
    expect(assertText("  ok  ", "t", 10)).toBe("ok");
    for (const bad of ["", "   ", "x".repeat(11), 5, null])
      expect(() => assertText(bad, "t", 10)).toThrow(ValidationError);
  });

  it("checks an instant", () => {
    const d = new Date("2026-10-12T00:00:00Z");
    expect(assertInstant(d, "at")).toBe(d);
    for (const bad of [new Date("x"), "2026-10-12", 0, null])
      expect(() => assertInstant(bad, "at")).toThrow(ValidationError);
  });

  it("reads the timestamps of a raw query, which drizzle hands over as text", () => {
    expect(asDate(null)).toBeNull();
    expect(asDate(undefined)).toBeNull();
    const d = new Date("2026-10-13T05:00:00Z");
    expect(asDate(d)).toBe(d);
    expect(asDate("2026-10-13 05:00:00+00")).toEqual(d);
    expect(asDate("2026-10-13 10:00:00.5+05")).toEqual(new Date("2026-10-13T05:00:00.500Z"));
    expect(() => asDate("yesterday")).toThrow(/not a date/);
  });
});
