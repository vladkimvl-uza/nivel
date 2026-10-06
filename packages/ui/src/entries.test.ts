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

/**
 * Imports and re-exports of a source file: specifiers that start with a dot, or a bare package. `import("x")` is a
 * dynamic import: it loads on demand, so only the graph of static imports counts for what an entry pulls in at once.
 */
function specifiers(file: string, dynamic: boolean): string[] {
  const text = readFileSync(file, "utf8");
  const statics = [...text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1] as string);
  const dynamics = [...text.matchAll(/import\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1] as string);
  return dynamic ? [...statics, ...dynamics] : statics;
}

/**
 * Every file reachable from `entry` through relative imports, and every bare package met on the way. With
 * `dynamic: false` the walk follows static imports only (what the entry loads at once).
 */
function graph(entry: string, { dynamic = true }: { dynamic?: boolean } = {}) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const walk = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of specifiers(file, dynamic)) {
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

const isThree = (p: string) => p === "three" || p.startsWith("three/");

describe("entries of @nivel/ui", () => {
  // The worker and the PDF renderer take brand colors and TTF names from the core entry; they run on plain Node,
  // which strips types from .ts but cannot load .tsx. A regression here shows only at the start of the worker.
  it("the core entry (index.ts) loads in plain Node and gives tokens, fonts and the night theme", () => {
    const url = pathToFileURL(join(SRC, "index.ts")).href;
    const run = inPlainNode(
      `const ui = await import(${JSON.stringify(url)});` +
        "console.log(JSON.stringify({" +
        "def: ui.defaultTheme, themes: ui.themes, ink: typeof ui.brand, fonts: ui.fontFaces.length," +
        "ttf: ui.fontFile(ui.fontFaces[0], 'ttf'), amount: ui.formatAmount(1234567), scene: typeof ui.sceneLight }));",
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(out).toMatchObject({ def: "night", themes: ["night"], ink: "object", scene: "object" });
    expect(out.fonts).toBeGreaterThanOrEqual(9);
    expect(String(out.ttf)).toMatch(/\.ttf$/);
    expect(String(out.amount)).toContain("567");
  });

  it("the core entry reaches no .tsx file and no react", () => {
    const { files, packages } = graph(join(SRC, "index.ts"));
    expect(files.filter((f) => f.endsWith(".tsx"))).toEqual([]);
    expect(packages.filter((p) => p === "react" || p.startsWith("react/") || p.startsWith("react-dom"))).toEqual([]);
    expect(files).toContain("themes/tokens.ts");
  });

  it("the core entry and the react entry do not pull three, nor the logo-motion core, at once", () => {
    for (const entry of ["index.ts", "react.ts"]) {
      const { files, packages } = graph(join(SRC, entry), { dynamic: false });
      expect(packages.filter(isThree), `${entry}: static imports of three`).toEqual([]);
      expect(
        files.filter((f) => f.startsWith("logo-motion/")),
        `${entry}: static imports of logo-motion`,
      ).toEqual([]);
    }
  });

  it("the react entry reaches the logo-motion core only through import() (LogoIntro loads it after idle time)", () => {
    const dynamic = graph(join(SRC, "react.ts"));
    expect(dynamic.files).toContain("logo-motion/index.ts");
    expect(dynamic.packages.filter(isThree).length).toBeGreaterThan(0);
    const calls = readFileSync(join(SRC, "logo", "LogoIntro.tsx"), "utf8").match(/import\s*\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
  });

  it("the logo-motion entry has no react and no .tsx, and it is the only entry that imports three", () => {
    const { files, packages } = graph(join(SRC, "logo-motion", "index.ts"));
    expect(files.filter((f) => f.endsWith(".tsx"))).toEqual([]);
    expect(packages.filter((p) => p === "react" || p.startsWith("react/") || p.startsWith("react-dom"))).toEqual([]);
    expect(packages.filter(isThree).sort()).toEqual(["three", "three/addons/environments/RoomEnvironment.js"]);
    expect(files).toContain("logo-motion/create.ts");
  });

  it("the logo-motion entry loads in plain Node and gives createLogoMotion and the timeline", () => {
    const url = pathToFileURL(join(SRC, "logo-motion", "index.ts")).href;
    const run = inPlainNode(
      `const m = await import(${JSON.stringify(url)});` +
        "console.log(JSON.stringify({ create: typeof m.createLogoMotion, clicks: m.CLICKS.length, d: m.INTRO_DURATION }));",
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ create: "function", clicks: 5, d: 3.3 });
  });

  it("the react entry (react.ts) has the primitives, the core entry has none of them", async () => {
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
    ];
    expect(components.filter((n) => !(n in react))).toEqual([]);
    expect(components.filter((n) => n in core)).toEqual([]);
  });

  it("the react entry has no theme components: no provider, hook, toggle or init script", async () => {
    const react = await import("./react.ts");
    const removed = ["ThemeInitScript", "ThemeProvider", "ThemeToggle", "ThemeToggleView", "useTheme"];
    expect(removed.filter((n) => n in react)).toEqual([]);
  });

  it("every source file of the package is reachable from one of the three entries (no orphan public code)", () => {
    const reach = new Set([
      ...graph(join(SRC, "index.ts")).files,
      ...graph(join(SRC, "react.ts")).files,
      ...graph(join(SRC, "logo-motion", "index.ts")).files,
    ]);
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
