// Design anti-list from BRIEF (ARCHITECTURE 5.7): forbidden fonts and colors, glass, colored glows, raw colors
// outside theme files. Owner after WP-00 — WP-09. Usage: node tools/check-antilist.mjs [--root <dir>]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, ROOT } from "./lib/env.mjs";
import { walk } from "./lib/files.mjs";

// Manrope is allowed only as outlines inside the logo SVG (no font name there), never as a font (DESIGN_SYSTEM 2.3, 8).
export const FORBIDDEN_FONTS = ["Geist Mono", "Geist", "Inter", "Onest", "Source Serif 4", "Manrope"];
export const FORBIDDEN_COLORS = [
  "#0C1230",
  "#111A3E",
  "#1D1D3E",
  "#0F2A4A",
  "#1E2A4A", // navy
  "#0070C8",
  "#378ADD",
  "#046BD2",
  "#3081F7", // blue
  "#7C6FF7",
  "#7F77DD",
  "#AFA9EC",
  "#EEF0FF", // violet, lavender
  "#12BCB7",
  "#1D9E75", // teal, emerald
];
/** Theme files may hold raw colors; everything else uses semantic tokens. */
export const THEME_FILES = [/^packages\/ui\/(src\/)?themes\//];
const SCAN_DIRS = ["apps", "packages"];
const TEXT_EXT = /\.(css|scss|tsx?|jsx?|mjs|html|svg)$/;
const SKIP_FILES = [/\.test\.[cm]?[jt]sx?$/, /^packages\/ui\/fonts\//];

const fontRe = new RegExp(`(?<![\\w-])(${FORBIDDEN_FONTS.map((f) => f.replace(/ /g, "[ _+-]?")).join("|")})(?![\\w-])`);
const colorRe = new RegExp(FORBIDDEN_COLORS.map((c) => `${c}(?![0-9a-f])`).join("|"), "i");
const cssHexRe = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const quotedHexRe = /["'`]#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})["'`]/i;
const rgbRe = /\b(?:rgba?|hsla?)\(\s*\d/i;
const anyHexRe = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const anyRgbRe = /\brgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/gi;
const glowVarRe = /var\(\s*--(?:accent|signal)/i;

/** Red and blue channels (0-255) of a hex color. */
function hexRedBlue(hex) {
  const h = hex.slice(1);
  if (h.length === 3 || h.length === 4) return [Number.parseInt(h[0] + h[0], 16), Number.parseInt(h[2] + h[2], 16)];
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(4, 6), 16)];
}

/** Colors in a theme file whose blue channel is above the red one: navy, blue, violet, teal. Night is warm black. */
function coldColors(line) {
  const out = [];
  for (const m of line.matchAll(anyHexRe)) {
    const [r, b] = hexRedBlue(m[0]);
    if (b > r) out.push(m[0]);
  }
  for (const m of line.matchAll(anyRgbRe)) {
    if (Number(m[3]) > Number(m[1])) out.push(m[0]);
  }
  return out;
}

/** Checks one file's text; `path` is POSIX and relative to the repo root. */
export function checkText(path, text) {
  const out = [];
  const isCss = /\.(css|scss)$/.test(path);
  const isTheme = THEME_FILES.some((r) => r.test(path));
  text.split(/\r?\n/).forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    if (/font|family/i.test(line)) {
      const f = fontRe.exec(line);
      if (f) out.push(`${at}: forbidden font "${f[1]}"`);
    }
    const c = colorRe.exec(line);
    if (c) out.push(`${at}: anti-list color ${c[0]}`);
    if (/backdrop-filter|backdropFilter/.test(line)) out.push(`${at}: backdrop-filter (glass) is forbidden`);
    else if (/(?<![\w.-])blur\(|feGaussianBlur/.test(line))
      out.push(`${at}: blur is forbidden (no glass, no glow, no haze)`);
    if (/drop-shadow\(/.test(line)) out.push(`${at}: drop-shadow is forbidden (paper shadows are box-shadow roles)`);
    if (/box-shadow|boxShadow|text-shadow|textShadow/i.test(line)) {
      const colored = /(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(line) && !isGray(line);
      if (colored || glowVarRe.test(line))
        out.push(`${at}: colored glow in ${/text/i.test(line) ? "text-shadow" : "box-shadow"}`);
    }
    if (isTheme) {
      for (const c of coldColors(line))
        out.push(`${at}: cold color ${c} in a theme file (blue above red; night is warm black)`);
    }
    if (!isTheme) {
      if ((isCss && cssHexRe.test(line)) || (!isCss && quotedHexRe.test(line))) {
        out.push(`${at}: raw HEX color outside theme files (use semantic tokens)`);
      } else if (rgbRe.test(line)) {
        out.push(`${at}: raw rgb()/hsl() color outside theme files (use semantic tokens)`);
      }
    }
  });
  return out;
}

function isGray(line) {
  const rgb = /rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/i.exec(line);
  if (rgb) return rgb[1] === rgb[2] && rgb[2] === rgb[3];
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(line);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    return h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
  }
  return false;
}

export function checkAntilist(root = ROOT) {
  const files = SCAN_DIRS.flatMap((d) => walk(root, join(root, d)))
    .filter((f) => TEXT_EXT.test(f))
    .filter((f) => !SKIP_FILES.some((r) => r.test(f)));
  return files.flatMap((f) => checkText(f, readFileSync(join(root, f), "utf8")));
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const violations = checkAntilist(values.root ?? ROOT);
  if (violations.length > 0) {
    console.error(`check-antilist: ${violations.length} violation(s):\n  - ${violations.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("check-antilist: no anti-list fonts, colors or effects");
}
