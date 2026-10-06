/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Owner decision of 06.10.2026 (R-18, ADR-006): the site is night only. These checks keep the switching machinery
// from coming back: the theme set, the choice by local time, storage, the provider, the toggle and the init script.
const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src");

/** Every non-test source and style file of the package, as `relative path -> text`. */
function sources(): Map<string, string> {
  const out = new Map<string, string>();
  const scan = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) scan(full);
      else if (/\.(tsx?|css|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.set(relative(PKG, full).replaceAll("\\", "/"), readFileSync(full, "utf8"));
      }
    }
  };
  scan(SRC);
  scan(join(PKG, "scripts"));
  return out;
}

describe("night only: the package has no way to switch themes", () => {
  const files = sources();

  it("scans a meaningful set of files", () => {
    expect(files.size).toBeGreaterThan(25);
    expect([...files.keys()]).toContain("src/themes/themes.css");
    expect([...files.keys()]).toContain("src/styles/primitives.css");
  });

  it("has no src/theming directory (only src/themes with tokens and ids)", () => {
    expect(existsSync(join(SRC, "theming"))).toBe(false);
    expect(existsSync(join(SRC, "themes", "ids.ts"))).toBe(true);
  });

  it('has no [data-theme="day"] and no data-theme="day" anywhere in styles or sources', () => {
    const hits = [...files].filter(([, text]) => /data-theme\s*[=\]]?\s*["']?day/.test(text)).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it("has no localStorage, event nv-theme, provider, hook, toggle or init script", () => {
    const banned =
      /localStorage|sessionStorage|nv-theme|ThemeProvider|useTheme|ThemeToggle|ThemeInitScript|themeInitScript|THEME_EVENT|theme-shift|themeByLocalTime|resolveTheme|CustomEvent/;
    const hits = [...files].filter(([, text]) => banned.test(text)).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it("has no day-only roles or classes: --logo-day, --lamp-opacity, --dur-theme, nv-seg2, nv-tod", () => {
    const banned = /logo-day|logo-night|logoDay|logoNight|lamp-opacity|lampOpacity|dur-theme|nv-seg2|nv-tod/;
    const hits = [...files].filter(([, text]) => banned.test(text)).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it("has no day branch in the scene light", () => {
    expect(files.get("src/themes/scene-light.ts")).not.toMatch(/\bday\b|sun\b/i);
  });

  it("renders react-dom/server by a plain import, not through createRequire from apps/web", () => {
    const render = files.get("src/test-support/render.ts") ?? "";
    expect(render).toMatch(/from "react-dom\/server"/);
    expect(render).not.toMatch(/createRequire|apps\/web/);
  });

  it("has a README about night only, without the integrator requests that are already done", () => {
    const readme = readFileSync(join(PKG, "README.md"), "utf8");
    expect(readme).toMatch(/ночь/i);
    expect(readme).not.toMatch(/Ночь и день|две темы|день\b/i);
    expect(readme).not.toMatch(
      /ThemeProvider|ThemeToggle|ThemeInitScript|themeInitScript|localStorage|nv-theme|\?theme=/,
    );
    expect(readme).not.toMatch(/Заявка интегратору/);
    expect(readme).not.toMatch(/createRequire/);
  });
});
