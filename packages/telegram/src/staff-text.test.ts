import { describe, expect, it } from "vitest";
import { isActPhotoCaption, parseReceiptCaption, stripOwnerNotes } from "./staff-text.ts";

describe("stripOwnerNotes: lines that begin with // never reach the customer", () => {
  it("passes a text without notes untouched", () => {
    expect(stripOwnerNotes("Salom!\nSmeta tayyor.")).toEqual({ text: "Salom!\nSmeta tayyor.", hadNotes: false });
  });

  it("removes the note lines and keeps the others", () => {
    expect(stripOwnerNotes("Good day\n// he is the cousin of a friend\nThe estimate is ready")).toEqual({
      text: "Good day\nThe estimate is ready",
      hadNotes: true,
    });
  });

  it("a message of notes only becomes empty", () => {
    expect(stripOwnerNotes("// remind me tomorrow\n//and call the shop")).toEqual({ text: "", hadNotes: true });
  });

  it("counts a note after leading spaces or tabs", () => {
    expect(stripOwnerNotes("  // note\n\t//note\nreal")).toEqual({ text: "real", hadNotes: true });
  });

  it("does not take a link or a mid-line // for a note", () => {
    const text = "see https://nivel.uz/ru\nprice // 1 200 000";
    expect(stripOwnerNotes(text)).toEqual({ text, hadNotes: false });
  });

  it("trims the blank lines the notes leave and keeps the blank line between paragraphs", () => {
    expect(stripOwnerNotes("// first\n\nHello\n\nBye\n// last")).toEqual({ text: "Hello\n\nBye", hadNotes: true });
  });

  it("works with Windows line breaks and with an empty or missing text", () => {
    expect(stripOwnerNotes("a\r\n// b\r\nc")).toEqual({ text: "a\nc", hadNotes: true });
    expect(stripOwnerNotes("")).toEqual({ text: "", hadNotes: false });
    expect(stripOwnerNotes(undefined)).toEqual({ text: "", hadNotes: false });
  });
});

describe("parseReceiptCaption: `1250000 Mycom` under the photo of a receipt", () => {
  it.each([
    ["1250000 Mycom", 1_250_000, "Mycom"],
    ["  1250000   Mycom  ", 1_250_000, "Mycom"],
    ["1 250 000 Mycom", 1_250_000, "Mycom"],
    ["1.250.000 Texnomart", 1_250_000, "Texnomart"],
    ["1,250,000 Texnomart Plus", 1_250_000, "Texnomart Plus"],
    ["850000 3D Shop", 850_000, "3D Shop"],
    ["1250000 сум Mycom", 1_250_000, "Mycom"],
    ["1250000 so'm Mycom", 1_250_000, "Mycom"],
    ["2500000 Itpark.uz", 2_500_000, "Itpark.uz"],
  ])("reads %j", (caption, amountSum, vendorName) => {
    expect(parseReceiptCaption(caption)).toEqual({ amountSum, vendorName });
  });

  it.each([
    "",
    "Mycom",
    "Mycom 1250000",
    "1250000",
    "0 Mycom",
    "-5 Mycom",
    "12.50 Mycom",
    "1e6 Mycom",
    "1250000.5 Mycom",
    "9999999999999 Mycom",
    "акт",
    "// 1250000 Mycom",
  ])("does not read %j", (caption) => {
    expect(parseReceiptCaption(caption)).toBeNull();
  });

  it("keeps the vendor to 80 characters", () => {
    expect(parseReceiptCaption(`1000 ${"x".repeat(81)}`)).toBeNull();
    expect(parseReceiptCaption(`1000 ${"x".repeat(80)}`)?.vendorName).toHaveLength(80);
  });

  it("handles nothing but a string", () => {
    expect(parseReceiptCaption(undefined)).toBeNull();
    expect(parseReceiptCaption(42 as never)).toBeNull();
  });
});

describe("isActPhotoCaption: the photo of a paper act", () => {
  it.each(["акт", "Акт сдачи", "act", "ACT handover", "dalolatnoma", "Dalolatnoma - qabul"])("recognises %j", (c) => {
    expect(isActPhotoCaption(c)).toBe(true);
  });
  it.each(["", "actor", "1250000 Mycom", "react", "актив", undefined])("does not recognise %j", (c) => {
    expect(isActPhotoCaption(c as never)).toBe(false);
  });
});
