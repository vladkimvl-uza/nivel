import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** Runs `code` as an ES module in a clean Node, the way `node src/main.ts` of worker and bot does (no bundler). */
function inPlainNode(code: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    cwd: SRC,
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

/** Relative imports and re-exports of a source file (specifiers that start with a dot, or a bare package). */
function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] as string);
}

/** Every file reachable from `entry` through relative imports, and every bare package met on the way. */
function graph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const walk = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of specifiers(file)) {
      if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
      else packages.add(spec);
    }
  };
  walk(entry);
  return {
    files: [...files].map((f) => relative(SRC, f).replaceAll("\\", "/")).sort(),
    packages: [...packages].sort(),
  };
}

describe("entries of @nivel/ui", () => {
  // The worker and the PDF renderer take brand colors and TTF names from the core entry; they run on plain Node,
  // which strips types from .ts but cannot load .tsx. A regression here shows only at the start of the worker.
  it("the core entry (index.ts) loads in plain Node and gives tokens, fonts and theme logic", () => {
    const url = pathToFileURL(join(SRC, "index.ts")).href;
    const run = inPlainNode(
      `const ui = await import(${JSON.stringify(url)});` +
        "console.log(JSON.stringify({" +
        "def: ui.defaultTheme, themes: ui.themes, ink: typeof ui.brand, fonts: ui.fontFaces.length," +
        "ttf: ui.fontFile(ui.fontFaces[0], 'ttf'), night: ui.themeByLocalTime(new Date(2026, 9, 6, 23))," +
        "script: ui.themeInitScript().slice(0, 12), amount: ui.formatAmount(1234567), scene: typeof ui.sceneLight }));",
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(out).toMatchObject({ def: "day", themes: ["day", "night"], ink: "object", night: "night", scene: "object" });
    expect(out.fonts).toBeGreaterThanOrEqual(9);
    expect(String(out.ttf)).toMatch(/\.ttf$/);
    expect(out.script).toBe("(function(){");
    expect(String(out.amount)).toContain("567");
  });

  it("the core entry reaches no .tsx file and no react", () => {
    const { files, packages } = graph(join(SRC, "index.ts"));
    expect(files.filter((f) => f.endsWith(".tsx"))).toEqual([]);
    expect(packages.filter((p) => p === "react" || p.startsWith("react/") || p.startsWith("react-dom"))).toEqual([]);
    expect(files).toContain("themes/tokens.ts");
  });

  it("the react entry (react.ts) has the primitives and the theme components, the core entry has none of them", async () => {
    const core = await import("./index.ts");
    const react = await import("./react.ts");
    const components = [
      "Badge",
      "Button",
      "EstimateRow",
      "EstimateTable",
      "Mark",
      "Money",
      "Paper",
      "RoundStamp",
      "Select",
      "Stamp",
      "StampInkDefs",
      "SumsTable",
      "Tag",
      "TextField",
      "ThemeInitScript",
      "ThemeProvider",
      "ThemeToggle",
      "ThemeToggleView",
      "useTheme",
    ];
    expect(components.filter((n) => !(n in react))).toEqual([]);
    expect(components.filter((n) => n in core)).toEqual([]);
  });

  it("every source file of the package is reachable from one of the two entries (no orphan public code)", () => {
    const reach = new Set([...graph(join(SRC, "index.ts")).files, ...graph(join(SRC, "react.ts")).files]);
    const all: string[] = [];
    const scan = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) scan(join(dir, e.name));
        else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !e.name.endsWith(".d.ts")) {
          all.push(relative(SRC, join(dir, e.name)).replaceAll("\\", "/"));
        }
      }
    };
    scan(SRC);
    const orphans = all.filter((f) => !reach.has(f) && !f.startsWith("test-support/"));
    expect(orphans).toEqual([]);
  });
});
