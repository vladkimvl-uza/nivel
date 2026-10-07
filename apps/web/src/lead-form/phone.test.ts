import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone.ts";

describe("normalizePhone", () => {
  it.each([
    ["+998901234567", "+998901234567"],
    ["+998 90 123 45 67", "+998901234567"],
    ["+998 (90) 123-45-67", "+998901234567"],
    ["998901234567", "+998901234567"],
    ["90 123 45 67", "+998901234567"],
    ["901234567", "+998901234567"],
    ["8 90 123 45 67", "+998901234567"],
    ["+998.71.234.56.78", "+998712345678"],
    ["  +998901234567  ", "+998901234567"],
  ])("takes %j as an Uzbek number: %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it("takes a foreign number with a plus in the international form", () => {
    expect(normalizePhone("+7 495 123-45-67")).toBe("+74951234567");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it.each([
    "",
    "   ",
    "abc",
    "12345",
    "+998 90 123 45", // too short
    "+998 90 123 45 678", // too long
    "+998 10 123 45 67", // no operator code starting with 1
    "+0 123 4567 890",
    "+1234567890123456", // 16 digits
    "90-123-45-67-89",
    "tel:+998901234567",
    "+998901234567; drop table",
  ])("refuses %j", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it("does not take a number that is not a string", () => {
    expect(normalizePhone(undefined as unknown as string)).toBeNull();
    expect(normalizePhone(null as unknown as string)).toBeNull();
    expect(normalizePhone(998901234567 as unknown as string)).toBeNull();
  });

  it("keeps the digits of any script out: only ASCII digits count", () => {
    expect(normalizePhone("+٩٩٨٩٠١٢٣٤٥٦٧")).toBeNull();
  });
});
