import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pdfMessages, pdfText } from "./messages.ts";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function flatten(tree: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    if (typeof v === "string") out.set(`${prefix}${k}`, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) && n !== "testkit.ts" ? [p] : [];
  });

const uz = flatten(pdfMessages.uz);
const ru = flatten(pdfMessages.ru);
const meta = JSON.parse(readFileSync(new URL("../../i18n/messages/meta/pdf.json", import.meta.url), "utf8")) as Record<
  string,
  { context?: string; maxLen?: number; status?: string }
>;

describe("the namespace pdf", () => {
  it("has the same keys in uz and ru and a meta entry for each", () => {
    expect([...uz.keys()].sort()).toEqual([...ru.keys()].sort());
    expect(Object.keys(meta).sort()).toEqual([...uz.keys()].sort());
    for (const [k, m] of Object.entries(meta)) {
      expect(m.context, k).toBeTruthy();
      expect(m.maxLen, k).toBeGreaterThan(0);
      expect(m.status, k).toBe("draft");
    }
  });

  it("keeps the same ICU arguments in both languages and no dollars", () => {
    const args = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of uz) {
      expect(args(ru.get(k) as string), k).toEqual(args(v));
      expect(`${v}${ru.get(k)}`, k).not.toMatch(/\$|USD/);
    }
  });

  it("writes Uzbek with U+02BB (oʻ, gʻ) and U+02BC and never with a plain or curly apostrophe inside a word", () => {
    for (const [k, v] of uz) {
      expect(v, k).not.toMatch(/[A-Za-zʻʼ]['’‘`][A-Za-zʻʼ]/);
      expect(v, k).not.toMatch(/[oOgG]['’‘`ʼ]/);
    }
    expect([...uz.values()].join("")).toContain("ʻ");
  });

  it("keeps each text within its limit from meta", () => {
    for (const [k, m] of Object.entries(meta)) {
      expect((uz.get(k) as string).length, `uz ${k}`).toBeLessThanOrEqual(m.maxLen as number);
      expect((ru.get(k) as string).length, `ru ${k}`).toBeLessThanOrEqual(m.maxLen as number);
    }
  });

  it("has every key the templates ask for and no key nobody asks for", () => {
    const text = sources(SRC)
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const used = new Set([...text.matchAll(/\bt\(\s*["'`]([\w.${}]+)["'`]/g)].map((m) => m[1] as string));
    const literal = [...used].filter((k) => !k.includes("${"));
    for (const k of literal) expect(uz.has(k), `the template asks for ${k}`).toBe(true);
    const dynamic = [...used].filter((k) => k.includes("${")).map((k) => k.slice(0, k.indexOf("${")));
    for (const key of uz.keys()) {
      const asked = used.has(key) || dynamic.some((prefix) => key.startsWith(prefix)) || text.includes(`"${key}"`);
      expect(asked, `nobody asks for ${key}`).toBe(true);
    }
  });

  it("says «NAMUNA / ОБРАЗЕЦ» on the watermark and «roʻyxatdan oʻtgach» for an IP not yet registered", () => {
    expect(pdfText("uz")("common.watermark")).toBe("NAMUNA / ОБРАЗЕЦ");
    expect(pdfText("ru")("common.watermark")).toBe("NAMUNA / ОБРАЗЕЦ");
    expect(pdfText("uz")("common.pending")).toBe("roʻyxatdan oʻtgach");
    expect(pdfText("ru")("common.pending")).toBe("после регистрации");
  });

  it("refuses an unknown key instead of printing it", () => {
    expect(() => pdfText("uz")("no.such.key")).toThrow();
  });

  it("holds no card number: sixteen digits in a row appear nowhere in the texts", () => {
    const all = [...uz.values(), ...ru.values()].join("\n");
    expect(all).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
  });
});
