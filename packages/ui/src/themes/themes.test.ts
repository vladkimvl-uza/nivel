/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCss } from "../test-support/css.ts";
import { defaultTheme, themes } from "./ids.ts";
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

const NIGHT = /:root,\s*\[data-theme="night"\]\s*\{/;
const ROOT = /:root\s*\{(?=\s*--asphalt)/;
const PROTO_NIGHT = /\[data-theme="night"\]\s*\{/;

/** Variables of the prototype that exist only to switch between day and night: the site has no switch (R-18, 06.10). */
const SWITCH_ONLY = new Set(["--logo-day", "--logo-night", "--lamp-opacity", "--dur-theme"]);

describe("theme ids (owner decision of 06.10.2026: night only)", () => {
  it("has the single theme night, and it is the default", () => {
    expect(themes).toEqual(["night"]);
    expect(defaultTheme).toBe("night");
  });

  it("keeps the data-theme contract: the token map is keyed by theme, so a second theme can come back", () => {
    expect(Object.keys(themeTokens)).toEqual([...themes]);
  });

  it("has one themes.css rule per theme, so a theme added to the list cannot silently fall back to night", () => {
    const css = buildThemesCss();
    for (const theme of themes) expect(css).toContain(`[data-theme="${theme}"]`);
    expect(css.match(/\[data-theme="/g)?.length).toBe(themes.length);
  });
});

describe("tokens", () => {
  it("keep the brand core of nivel-1", () => {
    expect(brand).toEqual({ asphalt: "#1D1D1B", signal: "#D9501A", signalDark: "#F06A30", paper: "#F1EFEA" });
  });

  it("have no day set and no role that exists only for switching", () => {
    expect(Object.keys(themeTokens)).not.toContain("day");
    const roles = Object.keys(themeTokens.night);
    for (const role of ["logoDay", "logoNight", "lampOpacity"]) expect(roles).not.toContain(role);
  });

  it("use only warm tones: no blue channel above the red one in any color", () => {
    const hex = /#([0-9a-f]{6})\b/gi;
    for (const [role, value] of Object.entries(themeTokens.night)) {
      for (const m of value.matchAll(hex)) {
        const h = m[1] as string;
        const [r, b] = [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(4, 6), 16)];
        expect(b, `night.${role} ${m[0]}`).toBeLessThanOrEqual(r);
      }
      for (const m of value.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
        expect(Number(m[3]), `night.${role} ${m[0]}`).toBeLessThanOrEqual(Number(m[1]));
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

  it("keep documents on paper with dark ink inside the night page", () => {
    expect(themeTokens.night.docInk).toBe("#1D1D1B");
    expect(themeTokens.night.doc).toBe("#E9E3D7");
    expect(themeTokens.night.stamp).toBe("#A93F17");
  });

  it("give the theme-color meta the page background", () => {
    expect(themeTokens.night.themeColor).toBe(themeTokens.night.bg);
  });

  it("have no gradients or glows, except the lamp spot behind documents", () => {
    expect(themeTokens.night.lampSpot).toMatch(/^radial-gradient\(/);
    for (const [role, value] of Object.entries(themeTokens.night)) {
      if (role !== "lampSpot") expect(value, `night.${role}`).not.toMatch(/gradient|blur|glow/i);
    }
  });
});

describe("themes.css", () => {
  it("is generated from the tokens (run packages/ui/scripts/build-css.mjs after a change)", () => {
    expect(normalizeCss(themesCss)).toBe(normalizeCss(buildThemesCss()));
  });

  it('has no day theme: no [data-theme="day"] rule and no other theme name than night', () => {
    expect(themesCss).not.toMatch(/\[data-theme="day"\]/);
    expect(themesCss).not.toMatch(/data-theme="(?!night")/);
    expect(buildThemesCss()).not.toMatch(/\[data-theme="day"\]/);
  });

  it("serves night through data-theme and to a page without the attribute", () => {
    expect(themesCss).toMatch(NIGHT);
    expect(themesCss.match(/\[data-theme=/g)).toHaveLength(1);
    expect(themesCss).not.toMatch(/prefers-color-scheme/);
    expect(themesCss).not.toMatch(/\.(day|night|dark|light)\b/);
  });

  it("declares the role variables of night", () => {
    const night = [...declarations(themesCss, NIGHT).keys()];
    expect(night).toContain("--bg");
    expect(night).toContain("--accent-ink");
    expect(night).toContain("--doc-ink-2");
    expect(night).toContain("--lamp-spot");
    expect(night).not.toContain("--theme-color");
    for (const name of SWITCH_ONLY) expect(night, name).not.toContain(name);
  });

  it("exposes one variable per token role", () => {
    const night = declarations(themesCss, NIGHT);
    for (const role of Object.keys(themeTokens.night)) {
      if (role === "themeColor") continue;
      expect(night.has(cssVarName(role)), role).toBe(true);
    }
  });

  it("has no variable for switching (the day-night fade duration, the logo pair, the lamp opacity)", () => {
    expect(themesCss).not.toMatch(/--dur-theme|--logo-(day|night)|--lamp-opacity/);
  });

  it("switches the mono font to Noto Sans Mono for Uzbek Latin", () => {
    const uz = declarations(themesCss, /html\[lang="uz-Latn"\]\s*\{/);
    expect(uz.get("--mono")).toContain("notosansmono");
  });

  it("equals the night values of the prototype index.html wherever the prototype defines a variable", () => {
    const proto = declarations(prototype, PROTO_NIGHT);
    const mine = declarations(themesCss, NIGHT);
    expect(proto.size).toBeGreaterThan(25);
    for (const [name, value] of proto) {
      if (SWITCH_ONLY.has(name)) continue;
      expect(normalize(mine.get(name) ?? "<missing>"), `night ${name}`).toBe(normalize(value));
    }
    const protoRoot = declarations(prototype, ROOT);
    const mineRoot = declarations(themesCss, ROOT);
    for (const [name, value] of protoRoot) {
      if (SWITCH_ONLY.has(name)) continue;
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
    const t: ThemeTokens = themeTokens.night;
    expect(Object.values(t).every((v) => typeof v === "string" && v.length > 0)).toBe(true);
  });
});
