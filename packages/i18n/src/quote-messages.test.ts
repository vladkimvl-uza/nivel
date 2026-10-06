// Texts of the warnings of computeQuote (WP-01 request, ARCHITECTURE 4.6): quote.empty, quote.reserve_high and
// quote.free_window_unavailable. The warning key is the message key: t(warning.key, warning.params) in namespace "quote".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeQuote, DEFAULT_FEE_SETTINGS, type QuoteContext, type QuoteLineInput } from "@nivel/domain/fee";
import { sum } from "@nivel/domain/money";
import { describe, expect, it } from "vitest";
import { getMessages, namespaces } from "./index.ts";
import { checkNamespace, flattenMessages, type MetaEntry } from "./messages-check.ts";
import { createNodeTranslator } from "./node-translator.ts";
import { checkUzString } from "./uz-apostrophes.ts";

const base = fileURLToPath(new URL("../messages/", import.meta.url));
const read = (kind: string) => JSON.parse(readFileSync(`${base}${kind}/quote.json`, "utf8"));
const KEYS = ["quote.empty", "quote.reserve_high", "quote.free_window_unavailable"];

const line = (unitSum: number, over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  key: "l",
  group: "pc",
  qty: 1,
  unitSum: sum(unitSum),
  isRamOrSsd: false,
  isFurnitureLike: false,
  customerOwned: false,
  purchasedByIp: true,
  ...over,
});
const ctx = (over: Partial<QuoteContext> = {}): QuoteContext => ({
  now: new Date("2026-10-06T07:00:00Z"),
  kind: "pc",
  complexBuild: false,
  freeWindowAvailable: false,
  confirmed: false,
  ...over,
});

describe("namespace quote", () => {
  it("is registered in the catalog and loads in both locales", () => {
    expect(namespaces).toContain("quote");
    for (const locale of ["uz", "ru"] as const) {
      const flat = flattenMessages(getMessages(locale, "quote").quote).map(([k]) => k);
      expect(flat.sort()).toEqual([...KEYS].sort());
    }
  });

  it("has the same keys in uz and ru, a meta entry per key and equal ICU arguments", () => {
    expect(checkNamespace("quote", read("uz"), read("ru"), read("meta"))).toEqual([]);
  });

  it("marks every Uzbek text as a draft for the translator (status draft, context and limit set)", () => {
    const meta = read("meta") as Record<string, MetaEntry>;
    expect(Object.keys(meta).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect(meta[key]?.status, key).toBe("draft");
      expect(meta[key]?.context.length, key).toBeGreaterThan(10);
      expect(meta[key]?.maxLen, key).toBeGreaterThanOrEqual(60);
    }
  });

  it("uses U+02BB and U+02BC in Uzbek and no Latin-ASCII apostrophes inside words", () => {
    const problems = flattenMessages(read("uz")).flatMap(([k, v]) => checkUzString(k, v));
    expect(problems).toEqual([]);
    const text = flattenMessages(read("uz"))
      .map(([, v]) => v)
      .join(" ");
    expect(text).toContain("ʻ"); // e.g. yoʻq, qoʻshing
    expect(text).not.toMatch(/\p{Script=Cyrillic}/u);
  });

  it("writes Russian in Cyrillic and no dollars", () => {
    const ru = Object.fromEntries(flattenMessages(read("ru")));
    for (const v of Object.values(ru)) expect(v).toMatch(/\p{Script=Cyrillic}/u);
    for (const v of Object.values(ru)) expect(v).not.toMatch(/\$|USD/);
  });

  it("names no threshold in the texts: the percentages are owner settings (FeeSettings), not the text's business", () => {
    for (const kind of ["ru", "uz"]) {
      for (const [k, v] of flattenMessages(read(kind))) expect(v, `${kind} ${k}`).not.toMatch(/\d/);
    }
  });

  it("never calls the free window free of charge: it is an unoccupied slot, the selection service is paid", () => {
    for (const [k, v] of flattenMessages(read("ru"))) expect(v, `ru ${k}`).not.toMatch(/бесплатн/i);
    for (const [k, v] of flattenMessages(read("uz"))) expect(v, `uz ${k}`).not.toMatch(/bepul/i);
    const ru = Object.fromEntries(flattenMessages(read("ru")));
    const uz = Object.fromEntries(flattenMessages(read("uz")));
    expect(ru["quote.free_window_unavailable"]).toMatch(/свободн/);
    expect(ru["quote.free_window_unavailable"]).toMatch(/платн/);
    expect(uz["quote.free_window_unavailable"]).toMatch(/pullik/);
  });
});

describe("warnings of computeQuote resolve to texts", () => {
  const scenarios: [string, ReturnType<typeof computeQuote>][] = [
    ["empty estimate", computeQuote([], DEFAULT_FEE_SETTINGS, ctx())],
    [
      "memory and SSD at 25 % of the purchase",
      computeQuote(
        [line(2_500_000, { key: "ram", isRamOrSsd: true }), line(7_500_000, { key: "rest" })],
        DEFAULT_FEE_SETTINGS,
        ctx(),
      ),
    ],
    ["free window not available", computeQuote([line(5_000_000)], DEFAULT_FEE_SETTINGS, ctx())],
  ];

  it("the three scenarios emit exactly the three keys of the request", () => {
    const keys = scenarios.flatMap(([, q]) => q.warnings.map((w) => w.key));
    expect(keys.sort()).toEqual([...KEYS].sort());
  });

  it("quote.empty also covers an estimate whose only lines are the customer's own items (nothing adds to the cost)", () => {
    const q = computeQuote([line(3_000_000, { customerOwned: true })], DEFAULT_FEE_SETTINGS, ctx());
    expect(q.warnings.map((w) => w.key)).toContain("quote.empty");
  });

  it.each(["uz", "ru"] as const)("%s: t(warning.key, warning.params) gives a text for every warning", (locale) => {
    const t = createNodeTranslator(locale, "quote");
    for (const [name, quote] of scenarios) {
      for (const w of quote.warnings) {
        const text = t(w.key, w.params ?? {});
        expect(text.trim().length, `${name}: ${w.key}`).toBeGreaterThan(20);
        expect(text).not.toContain("quote."); // not a raw key
        expect(text).not.toContain("{");
      }
    }
  });

  it("the texts of different warnings differ and uz differs from ru", () => {
    const uz = createNodeTranslator("uz", "quote");
    const ru = createNodeTranslator("ru", "quote");
    expect(new Set(KEYS.map((k) => ru(k))).size).toBe(3);
    expect(new Set(KEYS.map((k) => uz(k))).size).toBe(3);
    for (const k of KEYS) expect(uz(k)).not.toBe(ru(k));
  });

  it("keeps working when the reserve warning carries its shareBp parameter (extra values are allowed)", () => {
    const t = createNodeTranslator("ru", "quote");
    expect(() => t("quote.reserve_high", { shareBp: 2500 })).not.toThrow();
  });

  it("a key outside the namespace is an error, not an empty text", () => {
    expect(() => createNodeTranslator("uz", "quote")("quote.nothing")).toThrow();
  });
});
