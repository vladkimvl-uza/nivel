import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFiles, parseOwnership, run, wpFromBranch } from "../check-ownership.mjs";
import { ROOT } from "../lib/env.mjs";

let repo;
const git = (...args) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args], {
    cwd: repo,
    stdio: "pipe",
  });
const write = (rel, text = "x\n") => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "nivel-ownership-"));
  git("init", "-q", "-b", "main");
  mkdirSync(join(repo, "docs", "arch"), { recursive: true });
  copyFileSync(join(ROOT, "docs", "arch", "OWNERSHIP.md"), join(repo, "docs", "arch", "OWNERSHIP.md"));
  write("README.md");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-ownership", () => {
  it("maps branches to work packages", () => {
    expect(wpFromBranch("wp/01-money")).toBe("WP-01");
    expect(wpFromBranch("main")).toBeNull();
  });

  it("passes a branch that changes only its own paths", () => {
    git("checkout", "-q", "-b", "wp/01-money");
    write("packages/domain/src/money/index.ts", "export const ok = 1;\n");
    write("packages/testing/fixtures/wp-01/case.json", "{}\n");
    git("add", "-A");
    git("commit", "-q", "-m", "own files");
    const result = run({ cwd: repo, base: "main" });
    expect(result.wp).toBe("WP-01");
    expect(result.violations).toEqual([]);
  });

  it("catches a foreign file in a test branch", () => {
    write("packages/db/src/schema/sales.ts", "export {};\n");
    git("add", "-A");
    git("commit", "-q", "-m", "foreign file");
    const result = run({ cwd: repo, base: "main" });
    expect(result.violations).toEqual(["packages/db/src/schema/sales.ts: not owned by WP-01 (owner: WP-06)"]);
  });

  it("catches uncommitted changes and frozen contracts", () => {
    write("packages/domain/src/money/types.ts", "export type Sum = number;\n");
    const result = run({ cwd: repo, base: "main" });
    expect(result.violations).toContain(
      'packages/domain/src/money/types.ts: frozen contract (change via ADR and the integrator, label "contract")',
    );
  });

  it("treats Next.js route folders literally and honours exclusions", () => {
    const ownership = parseOwnership(
      [
        "## WP-16",
        "- `apps/web/app/[locale]/{layout.tsx,(marketing)}/**`",
        "## WP-09",
        "- `packages/ui/**`",
        "- `!packages/ui/src/direction/**`",
      ].join("\n"),
    );
    expect(
      checkFiles(
        ["apps/web/app/[locale]/(marketing)/page.tsx", "apps/web/app/[locale]/layout.tsx"],
        "WP-16",
        ownership,
      ),
    ).toEqual([]);
    expect(checkFiles(["apps/web/app/x/(marketing)/page.tsx"], "WP-16", ownership)).toHaveLength(1);
    expect(checkFiles(["packages/ui/src/direction/b/stamp.tsx"], "WP-09", ownership)).toHaveLength(1);
  });
});

describe("OWNERSHIP.md: registry of translation namespaces", () => {
  const text = readFileSync(join(ROOT, "docs", "arch", "OWNERSHIP.md"), "utf8");
  const section = (text.split(/^## /m).find((s) => s.startsWith("Реестр пространств имён")) ?? "").replace(/\r/g, "");

  it("has a section with the three rules", () => {
    expect(section).not.toBe("");
    // 1. The package that needs a namespace writes its files.
    expect(section).toContain("packages/i18n/messages/{uz,ru,meta}/<ns>.json");
    expect(section).toMatch(/пишет пакет, которому (это )?пространство нужно/);
    // 2. The integrator adds the registration at merge.
    expect(section).toContain("packages/i18n/src/catalog.ts");
    expect(section).toMatch(/интегратор/);
    // 3. Strict check before the merge.
    expect(section).toContain("NIVEL_STRICT_NAMESPACES=1");
  });

  it("does not turn into a list of owners: its bullets are not read as globs of a work package", () => {
    const { owners } = parseOwnership(text);
    // WP-00 keeps "**": the section's bullets (catalog.ts, messages/...) were not added to any owner.
    expect(owners.get("WP-00")?.include).toEqual(["**"]);
    for (const [wp, { include }] of owners) {
      expect(include.some((g) => g.includes("catalog.ts") || g.includes("NIVEL_STRICT")), wp).toBe(false);
    }
    // The namespace files are still owned by the packages that are named in OWNERSHIP.md.
    expect(owners.get("WP-12")?.include).toContain("packages/i18n/messages/{uz,ru,meta}/pdf.json");
  });
});
