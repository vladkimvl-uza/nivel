import { describe, expect, it } from "vitest";
import { MAX_BUDGET_MILLIONS, parseBudgetMillions } from "./budget.ts";

describe("parseBudgetMillions", () => {
  it.each([
    ["27", 27_000_000],
    ["27,5", 27_500_000],
    ["27.5", 27_500_000],
    ["27.55", 27_550_000],
    ["0,5", 500_000],
    ["0.001", 1_000],
    ["6,7", 6_700_000],
    ["1 000", 1_000_000_000],
    [" 15 ", 15_000_000],
    ["1000", 1_000_000_000],
  ])("turns %j million sums into %d whole sums", (raw, expected) => {
    expect(parseBudgetMillions(raw)).toEqual({ ok: true, sum: expected });
  });

  it("never goes through floating point: 0.29 million is exactly 290000 sums", () => {
    expect(parseBudgetMillions("0.29")).toEqual({ ok: true, sum: 290_000 });
    expect(parseBudgetMillions("1.1")).toEqual({ ok: true, sum: 1_100_000 });
    expect(parseBudgetMillions("8.2")).toEqual({ ok: true, sum: 8_200_000 });
  });

  it("treats an empty field as no budget", () => {
    expect(parseBudgetMillions("")).toEqual({ ok: true, sum: undefined });
    expect(parseBudgetMillions("   ")).toEqual({ ok: true, sum: undefined });
    expect(parseBudgetMillions(undefined)).toEqual({ ok: true, sum: undefined });
  });

  it.each(["abc", "-5", "1e3", "5,5,5", "5.0005", ".", ",5", "5.", "0", "00", "12 million", "٣٠", "1001"])(
    "refuses %j",
    (raw) => {
      expect(parseBudgetMillions(raw)).toEqual({ ok: false });
    },
  );

  it("caps the budget at the stated maximum", () => {
    expect(MAX_BUDGET_MILLIONS).toBe(1000);
    expect(parseBudgetMillions("1000.001")).toEqual({ ok: false });
  });
});
