import { describe, expect, it } from "vitest";
import ruCommon from "../messages/ru/common.json" with { type: "json" };
import uzCommon from "../messages/uz/common.json" with { type: "json" };
import { defaultLocale, getMessages, htmlLang, isLocale, locales, namespaces } from "./index.ts";
import { createNodeTranslator } from "./node-translator.ts";

describe("locales", () => {
  it("has Uzbek first and as default, Russian second", () => {
    expect(locales).toEqual(["uz", "ru"]);
    expect(defaultLocale).toBe("uz");
    expect(htmlLang).toEqual({ uz: "uz-Latn", ru: "ru" });
  });

  it.each([
    ["uz", true],
    ["ru", true],
    ["en", false],
    ["UZ", false],
    ["", false],
    [null, false],
    [undefined, false],
    [42, false],
    [{}, false],
  ])("isLocale(%j) is %s", (value, expected) => {
    expect(isLocale(value)).toBe(expected);
  });
});

describe("getMessages", () => {
  it("nests one namespace under its name (next-intl layout)", () => {
    expect(getMessages("uz", ["common"])).toEqual({ common: uzCommon });
    expect(getMessages("ru", ["common"])).toEqual({ common: ruCommon });
  });

  it("accepts a single namespace name as well as a list", () => {
    expect(getMessages("uz", "common")).toEqual({ common: uzCommon });
  });

  it("defaults to the common namespace (used by apps/web)", () => {
    expect(getMessages("uz")).toEqual({ common: uzCommon });
  });

  it("returns an empty object for an empty list", () => {
    expect(getMessages("ru", [])).toEqual({});
  });

  it("throws for a namespace that is not registered", () => {
    expect(() => getMessages("uz", "nope" as never)).toThrow(/Unknown namespace "nope"/);
  });

  it("lists the registered namespaces", () => {
    expect(namespaces).toContain("common");
  });
});

describe("createNodeTranslator", () => {
  it("translates a key in the given locale and namespace", () => {
    expect(createNodeTranslator("uz", "common")("lang.switch")).toBe("Til");
    expect(createNodeTranslator("ru", "common")("lang.switch")).toBe("Язык");
  });

  it("keeps the Uzbek letters oʻ and gʻ with U+02BB", () => {
    const t = createNodeTranslator("uz", "common");
    expect(t("lang.uz")).toBe("Oʻzbekcha");
    expect(t("home.lead")).toContain("yigʻib");
  });

  it("throws on a missing key instead of sending a raw key to the customer", () => {
    expect(() => createNodeTranslator("uz", "common")("no.such.key")).toThrow();
  });

  it("exposes has() to test for a key", () => {
    const t = createNodeTranslator("ru", "common");
    expect(t.has("home.heading")).toBe(true);
    expect(t.has("home.nothing")).toBe(false);
  });

  it("formats ICU arguments and plural rules per locale", () => {
    const messages = {
      uz: { demo: { items: "{count, plural, one {# ta mahsulot} other {# ta mahsulot}}", hi: "Salom, {name}!" } },
      ru: {
        demo: {
          items: "{count, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}",
          hi: "Здравствуйте, {name}!",
        },
      },
    };
    const ru = createNodeTranslator("ru", "demo", messages.ru);
    expect(ru("items", { count: 1 })).toBe("1 товар");
    expect(ru("items", { count: 3 })).toBe("3 товара");
    expect(ru("items", { count: 5 })).toBe("5 товаров");
    expect(ru("hi", { name: "Aziz" })).toBe("Здравствуйте, Aziz!");
    const uz = createNodeTranslator("uz", "demo", messages.uz);
    expect(uz("items", { count: 2 })).toBe("2 ta mahsulot");
  });

  it("throws when an ICU argument is missing", () => {
    const t = createNodeTranslator("uz", "demo", { demo: { hi: "Salom, {name}!" } });
    expect(() => t("hi")).toThrow();
  });
});

describe("Uzbek text API re-exported from the domain (ARCHITECTURE 4.12)", () => {
  it("exposes normalizeUz and uzSearchKey as functions", async () => {
    const api = await import("./index.ts");
    expect(typeof api.normalizeUz).toBe("function");
    expect(typeof api.uzSearchKey).toBe("function");
  });

  it.todo(
    "after the WP-02 merge: normalizeUz from @nivel/i18n turns apostrophes after o/g into U+02BB and other apostrophes between letters into U+02BC",
  );
  it.todo(`after the WP-02 merge: uzSearchKey("o'yin") equals uzSearchKey("oʻyin") (catalog search)`);
});
