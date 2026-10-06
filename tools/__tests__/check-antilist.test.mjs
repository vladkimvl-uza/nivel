import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkAntilist, checkText } from "../check-antilist.mjs";
import { ROOT } from "../lib/env.mjs";

const dirs = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("check-antilist", () => {
  it("catches #0C1230 and font-family: Inter", () => {
    const css = [".hero {", "  color: #0C1230;", "  font-family: Inter, sans-serif;", "}"].join("\n");
    const v = checkText("apps/web/app/x.css", css);
    expect(v).toContain("apps/web/app/x.css:2: anti-list color #0C1230");
    expect(v).toContain('apps/web/app/x.css:3: forbidden font "Inter"');
  });

  it("catches anti-list fonts in next/font and other effects", () => {
    expect(checkText("a.tsx", 'import { Geist } from "next/font/google";')).toHaveLength(1);
    expect(checkText("a.css", "backdrop-filter: blur(8px);")).toHaveLength(1);
    expect(checkText("a.css", "box-shadow: 0 0 24px rgba(240, 106, 48, 0.6);").join()).toContain("colored glow");
  });

  it("allows raw colors only in theme files and ignores look-alike words", () => {
    expect(checkText("packages/ui/themes/b-pasport.css", "--nv-signal: #D9501A;")).toEqual([]);
    expect(checkText("apps/web/app/x.css", "color: #D9501A;").join()).toContain("raw HEX");
    expect(checkText("a.ts", "// Interface of the font loader")).toEqual([]);
    expect(checkText("a.ts", "class A { #abc = 1 }")).toEqual([]);
  });

  it("scans a tree", () => {
    const root = mkdtempSync(join(tmpdir(), "nivel-antilist-"));
    dirs.push(root);
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    writeFileSync(join(root, "apps", "web", "bad.css"), "body { font-family: 'Inter'; color: #0c1230; }\n");
    expect(checkAntilist(root).length).toBeGreaterThanOrEqual(2);
  });
});

describe("check-antilist: design system rules (DESIGN_SYSTEM section 8)", () => {
  it("forbids Manrope as a font (it is allowed only as outlines inside the logo SVG)", () => {
    expect(checkText("a.css", "font-family: Manrope, sans-serif;").join()).toContain('forbidden font "Manrope"');
    expect(checkText("a.tsx", 'import { Manrope } from "next/font/google";').join()).toContain("Manrope");
    expect(checkText("a.css", "font-family: var(--sans);")).toEqual([]);
    expect(checkText("a.css", 'font-family: "Fira Sans", "IBM Plex Mono", "Brygada 1918", "Noto Sans Mono";')).toEqual(
      [],
    );
  });

  it("forbids blur: filter blur(), SVG Gaussian blur, drop-shadow with a color", () => {
    expect(checkText("a.css", "filter: blur(4px);").join()).toContain("blur");
    expect(checkText("a.css", "filter: url(#ink);")).toEqual([]);
    expect(checkText("a.tsx", "<feGaussianBlur stdDeviation={3} />").join()).toContain("blur");
    expect(checkText("a.css", "filter: drop-shadow(0 0 8px var(--accent));").join()).toContain("drop-shadow");
  });

  it("does not take the DOM method element.blur() or a local function for the blur filter", () => {
    expect(checkText("apps/web/src/menu.tsx", "buttonRef.current?.blur();")).toEqual([]);
    expect(checkText("apps/web/src/menu.tsx", "document.activeElement?.blur();")).toEqual([]);
    expect(checkText("apps/web/src/form.ts", "input.blur()")).toEqual([]);
    expect(checkText("apps/web/src/form.ts", 'el.style.filter = "blur(4px)";').join()).toContain("blur");
    expect(checkText("apps/web/src/form.ts", "const s = `blur(${n}px)`;").join()).toContain("blur");
    expect(checkText("a.css", "backdrop-filter:blur(8px);").join()).toBeTruthy();
  });

  it("forbids a colored text-shadow (a glow) but allows a gray one", () => {
    expect(checkText("a.css", "text-shadow: 0 0 12px rgba(240, 106, 48, 0.8);").join()).toContain("glow");
    expect(checkText("packages/ui/src/themes/x.css", "text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);")).toEqual([]);
    expect(checkText("a.css", "text-shadow: 0 0 6px var(--accent);").join()).toContain("glow");
  });

  it("forbids cold colors (blue channel above red) in theme files: warm night, no blue", () => {
    const file = "packages/ui/src/themes/tokens.ts";
    expect(checkText(file, 'bg: "#2A3F6B",').join()).toContain("cold color #2A3F6B");
    expect(checkText(file, "--x: #00f;").join()).toContain("cold color #00f");
    expect(checkText("packages/ui/src/themes/themes.css", "--x: rgba(10, 20, 200, 0.5);").join()).toContain(
      "cold color",
    );
    expect(checkText(file, 'bg: "#121110", ink: "#F1EFEA", accent: "#F06A30",')).toEqual([]);
    expect(checkText(file, "--line: rgba(29,29,27,.14);")).toEqual([]);
  });

  it("is clean on this repository: day and night themes, fonts catalog and primitives pass", () => {
    expect(checkAntilist(ROOT)).toEqual([]);
  });
});
