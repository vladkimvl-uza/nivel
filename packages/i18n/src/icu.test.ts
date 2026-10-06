import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import {
  checkIcuSyntax,
  compatibleSignature,
  numericNames,
  placeholderSignature,
  placeholders,
  placeholdersCompatible,
  sampleValues,
} from "./icu.ts";

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

describe("numericNames, compatibleSignature and placeholdersCompatible(uz, ru)", () => {
  const ruPlural = "{count, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}";

  it("numericNames lists the names the Russian text declares as number, plural or selectordinal", () => {
    expect(numericNames("{count} {n, number} {m, plural, other {#}} {o, selectordinal, other {#}}")).toEqual([
      "m",
      "n",
      "o",
    ]);
    expect(numericNames("Привет, {name}! {d, date} {g, select, other {x}}")).toEqual([]);
    expect(numericNames("{n} шт., {n, plural, other {#}}")).toEqual(["n"]);
  });

  it("compatibleSignature puts the numeric names' number-like types into one class and keeps the rest apart", () => {
    const numeric = new Set(["count"]);
    expect(compatibleSignature("{count}", numeric)).toEqual(["count:#numeric"]);
    expect(compatibleSignature("{count, number}", numeric)).toEqual(["count:#numeric"]);
    expect(compatibleSignature(ruPlural, numeric)).toEqual(["count:#numeric"]);
    expect(compatibleSignature("{count, selectordinal, other {#-chi}}", numeric)).toEqual(["count:#numeric"]);
    expect(compatibleSignature("{count, date}", numeric)).toEqual(["count:date"]);
    expect(compatibleSignature("{d, date, short} {t, time} {g, select, a {x} other {y}} {n}", new Set())).toEqual([
      "d:date",
      "g:select",
      "n:argument",
      "t:time",
    ]);
  });

  it("accepts the natural Uzbek '{count} ta ...' for a Russian plural (Uzbek does not decline the noun after a number)", () => {
    expect(placeholdersCompatible("{count} ta mahsulot", ruPlural)).toBe(true);
    expect(placeholdersCompatible("{count, number} ta mahsulot", ruPlural)).toBe(true);
    expect(placeholdersCompatible("{count, plural, one {# ta} other {# ta}}", ruPlural)).toBe(true);
    expect(placeholdersCompatible("{count, selectordinal, other {#-chi}}", ruPlural)).toBe(true);
    expect(placeholdersCompatible("{count} ta", "{count, number} шт.")).toBe(true);
  });

  it("is directed: a plain Russian {x} may be a string, so uz may not make it a number, plural or selectordinal", () => {
    expect(placeholdersCompatible("Salom, {name, number}!", "Привет, {name}!")).toBe(false);
    expect(placeholdersCompatible("{n, plural, other {#}}", "{n} шт.")).toBe(false);
    expect(placeholdersCompatible("{n, selectordinal, other {#}}", "{n} шт.")).toBe(false);
    expect(placeholdersCompatible("{n, number}", "{n}")).toBe(false);
    expect(placeholdersCompatible("Salom, {name}!", "Привет, {name}!")).toBe(true);
  });

  it("stays strict for the other types", () => {
    expect(placeholdersCompatible("{count} ta", "{count, date}")).toBe(false);
    expect(placeholdersCompatible("{count, date}", ruPlural)).toBe(false);
    expect(placeholdersCompatible("{d, date}", "{d}")).toBe(false);
    expect(placeholdersCompatible("{d, time}", "{d, date}")).toBe(false);
    expect(placeholdersCompatible("{g, select, other {x}}", "{g}")).toBe(false);
    expect(placeholdersCompatible("{d, date}", "{d, date}")).toBe(true);
  });

  it("stays strict for names: a different, missing or extra argument is not compatible", () => {
    expect(placeholdersCompatible("{soni} ta", ruPlural)).toBe(false);
    expect(placeholdersCompatible("ta mahsulot", ruPlural)).toBe(false);
    expect(placeholdersCompatible("{count} {extra}", "{count, plural, other {#}}")).toBe(false);
  });

  it("treats a name used both as a plain argument and as a plural like one numeric argument", () => {
    expect(placeholdersCompatible("{n} ta, {n, plural, other {#}}", "{n, plural, one {#} other {#}}")).toBe(true);
  });

  it("returns false for an argument that is used as a number in one message and as a date in the other part", () => {
    expect(placeholdersCompatible("{n} {n, date}", "{n, plural, other {#}}")).toBe(false);
  });

  it("does not take an invalid type word for a number: {n, numeric} is a syntax error and incompatible", () => {
    expect(checkIcuSyntax("{n, numeric}")).toContain("numeric");
    expect(placeholdersCompatible("{n, numeric}", "{n, plural, other {#}}")).toBe(false);
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

describe("what the real parser (use-intl) rejects", () => {
  it.each([
    ["unclosed tag", "Narx <b>{sum}"],
    ["closing tag without opening", "Narx {sum}</b>"],
    ["mismatched tags", "<b>Narx</i> {sum}"],
    ["tag closed in another branch", "{n, plural, one {<b>a} other {b</b>}}"],
    ["dot in an argument name", "Salom {user.name}"],
    ["dash in an argument name", "Salom {a-b}"],
    ["colon in an argument name", "Salom {a:b}"],
  ])("reports %s", (_name, message) => {
    expect(checkIcuSyntax(message)).toEqual(expect.any(String));
  });

  it.each([
    "<b>Narx</b> {sum}",
    "Qator<br/>ikkinchi",
    "<b><i>{x}</i></b>",
    "{n, plural, one {<b>#</b> kun} other {<b>#</b> kun}}",
    "{user_name} {a1} {0}",
    "1 < 2 and {x}",
  ])("accepts %j", (message) => {
    expect(checkIcuSyntax(message)).toBeNull();
  });
});

describe("sampleValues", () => {
  it("gives a string for plain and select arguments, a number for number-like ones, a Date for date and time", () => {
    const values = sampleValues(
      "{a} {n, number} {c, plural, one {#} other {#}} {o, selectordinal, other {#}} {d, date} {t, time} {g, select, x {y} other {z}}",
    );
    expect(values).toEqual({
      a: expect.any(String),
      n: expect.any(Number),
      c: expect.any(Number),
      o: expect.any(Number),
      d: expect.any(Date),
      t: expect.any(Date),
      g: "other",
    });
  });

  it("finds arguments nested in branches and returns nothing for plain text", () => {
    expect(Object.keys(sampleValues("{n, plural, other {{who} bought #}}")).sort()).toEqual(["n", "who"]);
    expect(sampleValues("Matn")).toEqual({});
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

describe("agreement with the real parser", () => {
  // use-intl reports unparsable messages as INVALID_MESSAGE; anything else (a missing tag function, say) is not a syntax error.
  function realParserRejects(message: string): boolean {
    let invalid = false;
    const t = createTranslator({
      locale: "uz",
      messages: { m: message },
      onError(error: { code?: string }) {
        if (error.code === "INVALID_MESSAGE") invalid = true;
      },
    } as Parameters<typeof createTranslator>[0]) as unknown as (key: string, values: object) => string;
    t("m", { ...sampleValues(message), b: () => "", i: () => "" });
    return invalid;
  }

  it.each([
    "Salom {name}",
    "<b>Narx</b> {sum}",
    "{n, plural, one {# kun} other {# kun}}",
    "Narx <b>{sum}",
    "Narx {sum}</b>",
    "<b>Narx</i> {sum}",
    "Salom {user.name}",
    "Salom {a-b}",
    "{n, plural, one {# kun}}",
    "Salom {name",
    "Salom {}",
  ])("agrees on %j", (message) => {
    expect(checkIcuSyntax(message) !== null).toBe(realParserRejects(message));
  });
});
