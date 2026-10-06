import { describe, expect, it } from "vitest";
import { convertToSum } from "./index.ts";
import type { FxRate } from "./types.ts";

const usd = (rate: string, nominal = 1): FxRate => ({ ccy: "USD", rate, nominal, effectiveDate: "2026-10-05" });

describe("convertToSum: acceptance", () => {
  it('"11772.95" × 1 000 $ = 11 772 950 sums (block 08, ARCHITECTURE 4.5)', () => {
    expect(convertToSum("1000", usd("11772.95"))).toBe(11_772_950);
  });

  it("converts other whole amounts exactly", () => {
    expect(convertToSum("100", usd("11772.95"))).toBe(1_177_295);
    expect(convertToSum("1", usd("11772.95"))).toBe(11_773); // 11 772.95 half-up
  });
});

describe("convertToSum: rounding and arithmetic", () => {
  it("rounds half up to a whole sum", () => {
    expect(convertToSum("1", usd("1.5"))).toBe(2);
    expect(convertToSum("1", usd("0.5"))).toBe(1);
    expect(convertToSum("1", usd("0.49"))).toBe(0);
    expect(convertToSum("1", usd("2.5"))).toBe(3);
  });

  it("does not suffer from binary float errors (1.005 × 100 = 100.5, not 100.4999…)", () => {
    expect(convertToSum("1.005", usd("100"))).toBe(101);
    expect(convertToSum("0.1", usd("3"))).toBe(0);
    expect(convertToSum("0.17", usd("3"))).toBe(1);
  });

  it("divides by the nominal of the rate", () => {
    expect(convertToSum("1", usd("11772.95", 10))).toBe(1177); // 1177.295
    expect(convertToSum("10", usd("11772.95", 10))).toBe(11_773); // 11 772.95
    expect(convertToSum("1", { ccy: "RUB", rate: "145.0", nominal: 1, effectiveDate: "2026-10-05" })).toBe(145);
  });

  it("keeps all digits of long decimals and large amounts", () => {
    expect(convertToSum("1000000000", usd("9007.19"))).toBe(9_007_190_000_000);
    expect(convertToSum("0.000001", usd("12345678.123456"))).toBe(12); // 12.345678…
  });

  it("zero amount is zero; leading zeros are accepted", () => {
    expect(convertToSum("0", usd("11772.95"))).toBe(0);
    expect(convertToSum("0.00", usd("11772.95"))).toBe(0);
    expect(convertToSum("007", usd("2"))).toBe(14);
  });

  it("works for EUR rates", () => {
    expect(convertToSum("10", { ccy: "EUR", rate: "13700.10", nominal: 1, effectiveDate: "2026-10-05" })).toBe(137_001);
  });
});

describe("convertToSum: invalid input", () => {
  it.each(["", " 1", "1 ", "-1", "+1", "1e3", "1,5", "1.", ".5", "abc", "1.2.3", "１２"])(
    "rejects amount %j",
    (amount) => {
      expect(() => convertToSum(amount, usd("11772.95"))).toThrow(RangeError);
    },
  );

  it.each(["", "0", "0.00", "-1", "1e3", "1,5", "x"])("rejects rate %j", (rate) => {
    expect(() => convertToSum("1", usd(rate))).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects nominal %s", (nominal) => {
    expect(() => convertToSum("1", usd("11772.95", nominal))).toThrow(RangeError);
  });

  it("rejects an unknown currency", () => {
    expect(() => convertToSum("1", { ...usd("1"), ccy: "GBP" as unknown as FxRate["ccy"] })).toThrow(RangeError);
  });

  it("rejects non-string amount and rate at runtime", () => {
    expect(() => convertToSum(1000 as unknown as string, usd("11772.95"))).toThrow(RangeError);
    expect(() => convertToSum("1", usd(11772.95 as unknown as string))).toThrow(RangeError);
  });

  it("rejects absurdly long decimal strings", () => {
    expect(() => convertToSum("1".repeat(41), usd("1"))).toThrow(RangeError);
    expect(() => convertToSum("1", usd(`1.${"0".repeat(60)}`))).toThrow(RangeError);
  });

  it("rejects a result beyond the safe integer range", () => {
    expect(() => convertToSum("9007199254740993", usd("1"))).toThrow(RangeError);
    expect(() => convertToSum("9007199254740", usd("1000000"))).toThrow(RangeError);
  });
});
