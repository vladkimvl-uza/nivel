// One owner per file (ARCHITECTURE 2.3, docs/arch/OWNERSHIP.md). A branch wp/NN-<name> may change only the globs
// of WP-NN; frozen contracts never. Usage: node tools/check-ownership.mjs [--wp NN] [--base main] [--cwd <repo>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, ROOT } from "./lib/env.mjs";
import { globToRegExp } from "./lib/files.mjs";

/** Parses OWNERSHIP.md: "## WP-NN" sections with "- `glob`" lines and the frozen contracts section. */
export function parseOwnership(markdown) {
  const owners = new Map();
  const frozen = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      const wp = /^WP-(\d{2})\b/.exec(h[1]);
      current = wp ? `WP-${wp[1]}` : /^Замороженные контракты/.test(h[1]) ? "FROZEN" : null;
      if (wp && !owners.has(current)) owners.set(current, { include: [], exclude: [] });
      continue;
    }
    const g = /^-\s+`([^`]+)`/.exec(line);
    if (!g || !current) continue;
    if (current === "FROZEN") frozen.push(g[1]);
    else {
      const entry = owners.get(current);
      if (g[1].startsWith("!")) entry.exclude.push(g[1].slice(1));
      else entry.include.push(g[1]);
    }
  }
  return { owners, frozen };
}

const compile = (globs) => globs.map((g) => globToRegExp(g));

/** Returns violations for `files` changed on a branch of work package `wp` ("WP-NN"). */
export function checkFiles(files, wp, ownership) {
  if (wp === "WP-00") return [];
  const entry = ownership.owners.get(wp);
  if (!entry) return [`${wp} has no section in docs/arch/OWNERSHIP.md`];
  const include = compile([...entry.include, `packages/testing/fixtures/${wp.toLowerCase()}/**`]);
  const exclude = compile(entry.exclude);
  const frozen = compile(ownership.frozen);
  const violations = [];
  for (const f of files) {
    if (frozen.some((r) => r.test(f))) {
      violations.push(`${f}: frozen contract (change via ADR and the integrator, label "contract")`);
    } else if (!include.some((r) => r.test(f)) || exclude.some((r) => r.test(f))) {
      violations.push(`${f}: not owned by ${wp}${ownerHint(f, ownership)}`);
    }
  }
  return violations;
}

function ownerHint(file, ownership) {
  for (const [wp, e] of ownership.owners) {
    if (wp === "WP-00") continue;
    if (compile(e.include).some((r) => r.test(file)) && !compile(e.exclude).some((r) => r.test(file))) {
      return ` (owner: ${wp})`;
    }
  }
  return " (owner: integrator)";
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Files changed on the branch since it left `base`, plus uncommitted and untracked ones. */
export function changedFiles(cwd, base) {
  const lines = [
    git(cwd, ["diff", "--name-only", `${base}...HEAD`]),
    git(cwd, ["diff", "--name-only", "HEAD"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard"]),
  ].join("\n");
  return [...new Set(lines.split(/\r?\n/).filter(Boolean))].sort();
}

export function wpFromBranch(branch) {
  const m = /^wp\/(\d{2})-/.exec(branch);
  return m ? `WP-${m[1]}` : null;
}

export function run({ cwd = ROOT, wp, base = "main" } = {}) {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const pkg = wp ? `WP-${wp.replace(/^WP-/i, "").padStart(2, "0")}` : wpFromBranch(branch);
  if (!pkg) return { skipped: `branch "${branch}" is not wp/NN-<name>`, violations: [] };
  const ownership = parseOwnership(readFileSync(join(cwd, "docs", "arch", "OWNERSHIP.md"), "utf8"));
  const files = changedFiles(cwd, base);
  return { wp: pkg, branch, files, violations: checkFiles(files, pkg, ownership) };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: { wp: { type: "string" }, base: { type: "string" }, cwd: { type: "string" } },
  });
  const result = run({ cwd: values.cwd ?? ROOT, wp: values.wp, base: values.base ?? "main" });
  if (result.skipped) {
    console.log(`check-ownership: skipped, ${result.skipped}`);
  } else if (result.violations.length > 0) {
    console.error(
      `check-ownership: ${result.wp} (${result.branch}) touches ${result.violations.length} foreign path(s):\n  - ${result.violations.join("\n  - ")}`,
    );
    process.exit(1);
  } else {
    const note = result.wp === "WP-00" ? " (integrator: all paths)" : "";
    console.log(`check-ownership: ${result.wp}, ${result.files.length} changed file(s) OK${note}`);
  }
}
