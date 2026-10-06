import { describe, expect, it } from "vitest";
import { checkIcuSyntax, placeholderSignature, placeholders } from "./icu.ts";

describe("placeholders", () => {
  it("returns sorted argument names", () => {
    expect(placeholders("Salom {name}, {count} ta")).toEqual(["count", "name"]);
    expect(placeholders("{count, plural, one {# sum} other {# sum}} {name}")).toEqual(["count", "name"]);
  });

  it("returns an empty list for plain text and empty input", () => {
    expect(placeholders("Hech narsa")).toEqual([]);
    expect(placeholders("")).toEqual([]);
  });

  it("finds arguments nested in plural and select branches", () => {
    const m = "{gender, select, male {{name} keldi} female {{name} keldi} other {{who} keldi}}";
    expect(placeholders(m)).toEqual(["gender", "name", "who"]);
  });

  it("does not take selector keywords, # or format styles for arguments", () => {
    expect(placeholders("{n, plural, one {# kun} other {# kun}}")).toEqual(["n"]);
    expect(placeholders("{d, date, short}")).toEqual(["d"]);
  });

  it("deduplicates repeated arguments", () => {
    expect(placeholders("{a} {a} {a}")).toEqual(["a"]);
  });

  it("ignores text in ICU single-quote escapes", () => {
    expect(placeholders("'{'not an arg'}' {real}")).toEqual(["real"]);
  });

  it("handles rich-text tags without treating them as arguments", () => {
    expect(placeholders("<b>{name}</b>")).toEqual(["name"]);
  });
});

describe("placeholderSignature", () => {
  it("includes the argument type, so number and text arguments differ", () => {
    expect(placeholderSignature("{count, plural, one {#} other {#}}")).toEqual(["count:plural"]);
    expect(placeholderSignature("{count}")).toEqual(["count:argument"]);
    expect(placeholderSignature("{count, number}")).toEqual(["count:number"]);
    expect(placeholderSignature("{d, date, short} {n}")).toEqual(["d:date", "n:argument"]);
  });

  it("is the same for uz and ru plural forms with different categories", () => {
    const uz = "{count, plural, one {# ta} other {# ta}}";
    const ru = "{count, plural, one {# шт.} few {# шт.} many {# шт.} other {# шт.}}";
    expect(placeholderSignature(uz)).toEqual(placeholderSignature(ru));
  });
});

describe("checkIcuSyntax", () => {
  it("accepts valid messages", () => {
    expect(checkIcuSyntax("Salom {name}")).toBeNull();
    expect(checkIcuSyntax("{n, plural, one {# kun} other {# kun}}")).toBeNull();
    expect(checkIcuSyntax("Matn")).toBeNull();
  });

  it.each([
    ["unclosed brace", "Salom {name"],
    ["stray closing brace", "Salom name}"],
    ["plural without other", "{n, plural, one {# kun}}"],
    ["empty argument", "Salom {}"],
  ])("reports %s", (_name, message) => {
    expect(checkIcuSyntax(message)).toEqual(expect.any(String));
  });
});

describe("ICU details", () => {
  it.each([
    "{n, plural, offset:1 =0 {hech kim} one {# kishi} other {# kishi}}",
    "{n, selectordinal, one {#-chi} other {#-chi}}",
    "{x, number, ::currency/UZS}",
    "{d, time, short}",
    "It''s {x}",
    "a < b and b > a with {x}",
    "{g, select, a {A} other {B}}",
  ])("accepts %j", (message) => {
    expect(checkIcuSyntax(message)).toBeNull();
  });

  it.each([
    ["selector without a branch", "{n, plural, one}"],
    ["no options", "{n, plural,}"],
    ["unclosed plural", "{n, plural, one {# a} other {# b}"],
    ["missing comma", "{n plural}"],
    ["missing type", "{n, }"],
    ["unclosed number", "{n, number"],
    ["unclosed style", "{n, number, short"],
    ["nested brace as type", "{b {c}}"],
    ["unclosed branch", "{n, plural, other {# a"],
    ["no selector", "{n, select, {x}}"],
  ])("reports %s", (_name, message) => {
    expect(checkIcuSyntax(message)).toEqual(expect.any(String));
  });

  it("treats '#' quoted in a plural as text and an unclosed quote as quoting to the end", () => {
    expect(checkIcuSyntax("{n, plural, other {'#' kun}}")).toBeNull();
    expect(placeholders("'{x}")).toEqual([]);
  });

  it("returns what it found before a syntax error", () => {
    expect(placeholders("{a} {b")).toEqual(["a"]);
  });
});
