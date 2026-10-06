/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCss } from "../test-support/css.ts";
import { defaultTheme, themes } from "../theming/ids.ts";
import { buildThemesCss, cssVarName } from "./to-css.ts";
import { brand, type ThemeTokens, themeTokens } from "./tokens.ts";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const themesCss = readFileSync(here("./themes.css"), "utf8");
const prototype = readFileSync(here("../../../../docs/design/day-night/index.html"), "utf8");

/** Declarations of the first rule whose selector matches, as `--name -> value` with whitespace stripped. */
function declarations(css: string, selector: RegExp): Map<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`rule ${selector} not found`);
  const body = css.slice(m.index + m[0].length, css.indexOf("}", m.index + m[0].length));
  const out = new Map<string, string>();
  for (const decl of body.split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    out.set(
      decl.slice(0, at).trim(),
      decl
        .slice(at + 1)
        .replace(/\s+/g, "")
        .toLowerCase(),
    );
  }
  return out;
}

/** `#000` and `#000000` are the same value, so are `.15s` and `0.15s`. */
const normalize = (v: string) =>
  v.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])(?![0-9a-f])/g, "#$1$1$2$2$3$3").replace(/(?<!\d)\.(\d)/g, "0.$1");

const DAY = /:root,\s*\[data-theme="day"\]\s*\{/;
const ROOT = /:root\s*\{(?=\s*--asphalt)/;
const NIGHT = /\[data-theme="night"\]\s*\{/;

describe("theme ids", () => {
  it("are day and night; the default (before the visitor's local time is known) is day", () => {
    expect(themes).toEqual(["day", "night"]);
    expect(defaultTheme).toBe("day");
  });
});

describe("tokens", () => {
  it("keep the brand core of nivel-1", () => {
    expect(brand).toEqual({ asphalt: "#1D1D1B", signal: "#D9501A", signalDark: "#F06A30", paper: "#F1EFEA" });
  });

  it("define exactly the same roles in both themes (modes change colors, not structure)", () => {
    expect(Object.keys(themeTokens.night)).toEqual(Object.keys(themeTokens.day));
  });

  it("use only warm tones: no blue channel above the red one in any color", () => {
    const hex = /#([0-9a-f]{6})\b/gi;
    for (const theme of themes) {
      for (const [role, value] of Object.entries(themeTokens[theme])) {
        for (const m of value.matchAll(hex)) {
          const h = m[1] as string;
          const [r, b] = [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(4, 6), 16)];
          expect(b, `${theme}.${role} ${m[0]}`).toBeLessThanOrEqual(r);
        }
        for (const m of value.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
          expect(Number(m[3]), `${theme}.${role} ${m[0]}`).toBeLessThanOrEqual(Number(m[1]));
        }
      }
    }
  });

  it("make night a warm black: R >= G >= B for every dark surface", () => {
    const n = themeTokens.night;
    for (const role of ["bg", "bg2", "surface", "stage", "foot", "wood"] as const) {
      const h = n[role];
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
      expect(r >= g && g >= b, `night.${role} ${h}`).toBe(true);
    }
  });

  it("keep documents paper in both modes, with dark ink", () => {
    for (const theme of themes) {
      expect(themeTokens[theme].docInk).toBe("#1D1D1B");
    }
    expect(themeTokens.night.doc).toBe("#E9E3D7");
    expect(themeTokens.day.doc).toBe("#FBF9F4");
  });

  it("flip the logo and the theme-color meta with the mode", () => {
    expect([themeTokens.day.logoDay, themeTokens.day.logoNight]).toEqual(["1", "0"]);
    expect([themeTokens.night.logoDay, themeTokens.night.logoNight]).toEqual(["0", "1"]);
    expect(themeTokens.day.themeColor).toBe(themeTokens.day.bg);
    expect(themeTokens.night.themeColor).toBe(themeTokens.night.bg);
  });

  it("have no gradients or glows, except the lamp spot behind documents that exists only at night", () => {
    expect(themeTokens.day.lampSpot).toBe("none");
    expect(themeTokens.night.lampSpot).toMatch(/^radial-gradient\(/);
    for (const theme of themes) {
      for (const [role, value] of Object.entries(themeTokens[theme])) {
        if (role !== "lampSpot") expect(value, `${theme}.${role}`).not.toMatch(/gradient|blur|glow/i);
      }
    }
  });
});

describe("themes.css", () => {
  it("is generated from the tokens (run packages/ui/scripts/build-css.mjs after a change)", () => {
    expect(normalizeCss(themesCss)).toBe(normalizeCss(buildThemesCss()));
  });

  it("switches by the data-theme attribute only, with day as the unattributed default", () => {
    expect(themesCss).toMatch(DAY);
    expect(themesCss).toMatch(NIGHT);
    expect(themesCss).not.toMatch(/prefers-color-scheme/);
    expect(themesCss).not.toMatch(/\.(day|night|dark|light)\b/);
  });

  it("declares the same variable names in day and night", () => {
    const day = [...declarations(themesCss, DAY).keys()];
    const night = [...declarations(themesCss, NIGHT).keys()];
    expect(night).toEqual(day);
    expect(day).toContain("--bg");
    expect(day).toContain("--accent-ink");
    expect(day).toContain("--doc-ink-2");
    expect(day).not.toContain("--theme-color");
  });

  it("exposes one variable per token role", () => {
    const day = declarations(themesCss, DAY);
    for (const role of Object.keys(themeTokens.day)) {
      if (role === "themeColor") continue;
      expect(day.has(cssVarName(role)), role).toBe(true);
    }
  });

  it("switches the mono font to Noto Sans Mono for Uzbek Latin", () => {
    const uz = declarations(themesCss, /html\[lang="uz-Latn"\]\s*\{/);
    expect(uz.get("--mono")).toContain("notosansmono");
  });

  it("equals the values of the prototype index.html wherever the prototype defines a variable", () => {
    for (const selector of [DAY, NIGHT]) {
      const proto = declarations(prototype, selector);
      const mine = declarations(themesCss, selector);
      expect(proto.size).toBeGreaterThan(25);
      for (const [name, value] of proto) {
        expect(normalize(mine.get(name) ?? "<missing>"), `${selector} ${name}`).toBe(normalize(value));
      }
    }
    const protoRoot = declarations(prototype, ROOT);
    const mineRoot = declarations(themesCss, ROOT);
    for (const [name, value] of protoRoot) {
      expect(normalize(mineRoot.get(name) ?? "<missing>"), name).toBe(normalize(value));
    }
  });
});

describe("cssVarName", () => {
  it("maps camelCase roles to the prototype names", () => {
    expect(cssVarName("bg")).toBe("--bg");
    expect(cssVarName("bg2")).toBe("--bg-2");
    expect(cssVarName("accentInk")).toBe("--accent-ink");
    expect(cssVarName("docInk2")).toBe("--doc-ink-2");
    expect(cssVarName("woodInk2")).toBe("--wood-ink-2");
    expect(cssVarName("hdrBg")).toBe("--hdr-bg");
  });
});

describe("type of a theme", () => {
  it("requires every role (compile-time check, runtime sanity)", () => {
    const t: ThemeTokens = themeTokens.day;
    expect(Object.values(t).every((v) => typeof v === "string" && v.length > 0)).toBe(true);
  });
});
