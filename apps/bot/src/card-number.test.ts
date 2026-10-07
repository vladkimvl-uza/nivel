import { describe, expect, it } from "vitest";
import { looksLikeCard, maskCardNumbers } from "./card-number.ts";

describe("what looks like a number of a bank card", () => {
  it.each([
    "8600123456789012",
    "8600 1234 5678 9012",
    "8600-1234-5678-9012",
    "Karta 8600 1234 5678 9012.",
    "holder, 8600 1234 5678 9012, bank",
  ])("%s is a card", (text) => {
    expect(looksLikeCard(text)).toBe(true);
  });

  it.each([
    "20208000900100000001",
    "2020 8000 9001 0000 0001",
    "2020-8000-9001-0000-0001",
    "YaTT Nivel, Test Bank, 2020 8000 9001 0000 0001, 00014, 123456789",
    "1250000 Mycom",
    "+998 90 123 45 67",
    "",
  ])("%s is not", (text) => {
    expect(looksLikeCard(text)).toBe(false);
  });

  it("an account of twenty digits and a card in the same line: the card is still found", () => {
    expect(looksLikeCard("2020 8000 9001 0000 0001 va karta 8600 1234 5678 9012")).toBe(true);
  });

  it("masks every card number and leaves the rest of the words", () => {
    expect(maskCardNumbers("Karta 8600 1234 5678 9012 ishlamayapti, 1111222233334444 ham")).toBe(
      "Karta [...] ishlamayapti, [...] ham",
    );
    expect(maskCardNumbers("no digits here")).toBe("no digits here");
  });
});
