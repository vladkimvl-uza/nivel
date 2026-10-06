import { describe, expect, it } from "vitest";
import { formatAmount, formatBp, MINUS, NBSP } from "./format.ts";

describe("formatAmount: whole sums, non-breaking space between thousands", () => {
  it("groups by three with U+00A0", () => {
    expect(formatAmount(26_830_000)).toBe(`26${NBSP}830${NBSP}000`);
    expect(formatAmount(1000)).toBe(`1${NBSP}000`);
    expect(formatAmount(999)).toBe("999");
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(12_500_000)).toBe(`12${NBSP}500${NBSP}000`);
  });

  it("never uses a breaking space (the sum must not wrap, DESIGN_SYSTEM 2.3)", () => {
    expect(formatAmount(26_830_000)).not.toContain(" ");
    expect(NBSP).toBe(" ");
  });

  it("writes a refund with the true minus sign U+2212, not a hyphen", () => {
    expect(formatAmount(-140_000)).toBe(`${MINUS}140${NBSP}000`);
    expect(MINUS).toBe("−");
  });

  it("handles the largest safe integer and negative zero", () => {
    expect(formatAmount(Number.MAX_SAFE_INTEGER)).toBe(`9${NBSP}007${NBSP}199${NBSP}254${NBSP}740${NBSP}991`);
    expect(formatAmount(-0)).toBe("0");
  });

  it("round-trips: stripping the format gives the number back, for 10 000 pseudo-random sums", () => {
    let seed = 20261006;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 10_000; i++) {
      const n = next() % 2 === 0 ? next() * (1 + (next() % 1000)) : -next();
      const text = formatAmount(n);
      expect(Number(text.replaceAll(NBSP, "").replace(MINUS, "-")), text).toBe(n);
    }
  });

  it("refuses everything that is not a whole sum: money is integers (CLAUDE.md)", () => {
    for (const bad of [1.5, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "100" as never, null as never]) {
      expect(() => formatAmount(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe("formatBp: rates in basis points, no float arithmetic", () => {
  it("prints percent with a comma and a non-breaking space before the sign", () => {
    expect(formatBp(1500)).toBe(`15${NBSP}%`);
    expect(formatBp(1000)).toBe(`10${NBSP}%`);
    expect(formatBp(300)).toBe(`3${NBSP}%`);
    expect(formatBp(10_000)).toBe(`100${NBSP}%`);
    expect(formatBp(0)).toBe(`0${NBSP}%`);
  });

  it("keeps the fraction: 1250 bp is 12,5 %, 5 bp is 0,05 %", () => {
    expect(formatBp(1250)).toBe(`12,5${NBSP}%`);
    expect(formatBp(1005)).toBe(`10,05${NBSP}%`);
    expect(formatBp(5)).toBe(`0,05${NBSP}%`);
    expect(formatBp(10)).toBe(`0,1${NBSP}%`);
  });

  it("handles negative rates", () => {
    expect(formatBp(-250)).toBe(`${MINUS}2,5${NBSP}%`);
  });

  it("refuses fractions of a basis point", () => {
    expect(() => formatBp(12.5)).toThrow(RangeError);
    expect(() => formatBp(Number.NaN)).toThrow(RangeError);
  });
});
