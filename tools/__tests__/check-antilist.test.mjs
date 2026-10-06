import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkAntilist, checkText } from "../check-antilist.mjs";

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
