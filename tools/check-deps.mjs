// Package dependency graph (ARCHITECTURE 2.2): no reverse edges, no app-to-app imports, domain is pure.
// Checks both package.json dependencies and import specifiers in source files.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { isMain, ROOT } from "./lib/env.mjs";
import { isDir, toPosix, walk } from "./lib/files.mjs";

/** Allowed internal dependencies per package. Apps may use any package, never another app. */
export const ALLOWED = {
  domain: [],
  config: [],
  contracts: ["domain"],
  db: ["contracts", "domain"],
  services: ["db", "domain", "contracts"],
  i18n: ["domain"],
  ui: [],
  pdf: ["domain", "i18n", "contracts", "ui"],
  ai: ["domain", "contracts", "services"],
  telegram: ["contracts", "i18n"],
  testing: ["config", "db", "domain", "contracts", "services", "i18n"],
};
export const APPS = ["web", "admin", "bot", "worker"];

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const IMPORT_RE =
  /(?:import|export)\s[^'"`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function workspaceUnits(root) {
  const units = [];
  for (const kind of ["packages", "apps"]) {
    const base = join(root, kind);
    if (!isDir(base)) continue;
    for (const name of walkDirs(base)) {
      const pj = join(base, name, "package.json");
      if (existsSync(pj)) units.push({ kind, name, dir: join(base, name), pkg: readJson(pj) });
    }
  }
  return units;
}

function walkDirs(base) {
  return walk(base, base, { skipDirs: new Set(["node_modules"]) })
    .filter((f) => /^[^/]+\/package\.json$/.test(f))
    .map((f) => f.split("/")[0]);
}

/** Maps an import specifier or a relative path to the internal unit it points at, if any. */
function targetOf(spec, fromFile, root) {
  const scoped = /^@nivel\/([^/]+)/.exec(spec);
  if (scoped) {
    const name = scoped[1];
    return APPS.includes(name) ? { kind: "apps", name } : { kind: "packages", name };
  }
  if (spec.startsWith(".")) {
    const abs = toPosix(normalize(join(dirname(fromFile), spec)));
    const rel = toPosix(normalize(abs)).replace(`${toPosix(root)}/`, "");
    const m = /^(apps|packages)\/([^/]+)/.exec(rel);
    if (m) return { kind: m[1], name: m[2] };
  }
  return null;
}

export function checkDeps(root = ROOT) {
  const violations = [];
  const units = workspaceUnits(root);

  for (const u of units) {
    const label = `${u.kind}/${u.name}`;
    const allowed = u.kind === "apps" ? null : (ALLOWED[u.name] ?? null);
    if (u.kind === "packages" && allowed === null) {
      violations.push(`${label}: package is not in the dependency graph (tools/check-deps.mjs ALLOWED)`);
      continue;
    }
    const deps = { ...u.pkg.dependencies, ...u.pkg.devDependencies, ...u.pkg.peerDependencies };

    // package.json edges
    for (const dep of Object.keys(deps)) {
      const m = /^@nivel\/(.+)$/.exec(dep);
      if (!m) continue;
      const name = m[1];
      if (APPS.includes(name)) violations.push(`${label}: depends on app @nivel/${name}`);
      else if (allowed && !allowed.includes(name))
        violations.push(`${label}: dependency @nivel/${name} is not allowed`);
    }
    if (u.kind === "packages" && u.name === "domain" && Object.keys(u.pkg.dependencies ?? {}).length > 0) {
      violations.push("packages/domain: must have zero runtime dependencies");
    }

    // source imports
    for (const rel of walk(u.dir).filter((f) => SOURCE_EXT.test(f))) {
      const file = join(u.dir, rel);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (!spec) continue;
        const where = `${label}/${rel}`;
        if (
          u.kind === "packages" &&
          u.name === "domain" &&
          !spec.startsWith(".") &&
          !/^(vitest|fast-check)$/.test(spec)
        ) {
          violations.push(`${where}: domain imports "${spec}" (pure package: relative imports only)`);
          continue;
        }
        const t = targetOf(spec, file, root);
        if (!t || (t.kind === u.kind && t.name === u.name)) continue;
        if (t.kind === "apps") {
          violations.push(`${where}: imports app "${t.name}" ("${spec}")`);
        } else if (allowed && !allowed.includes(t.name)) {
          violations.push(`${where}: imports @nivel/${t.name} ("${spec}"), not allowed for ${label}`);
        } else if (spec.startsWith(".")) {
          violations.push(`${where}: relative import into ${t.kind}/${t.name} ("${spec}"); use @nivel/${t.name}`);
        } else if (!(`@nivel/${t.name}` in deps)) {
          violations.push(`${where}: imports @nivel/${t.name} without declaring it in package.json`);
        }
      }
    }
  }
  return violations;
}

if (isMain(import.meta.url)) {
  const violations = checkDeps();
  if (violations.length > 0) {
    console.error(`check-deps: ${violations.length} violation(s):\n  - ${violations.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("check-deps: dependency graph OK");
}
