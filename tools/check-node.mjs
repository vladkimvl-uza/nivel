// CI and integrator checks run on Node 24 only (ARCHITECTURE 1.2). pnpm provides 24.21.0 via devEngines.runtime;
// running this file with the global Node 25 must fail.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, ROOT } from "./lib/env.mjs";

const REQUIRED_MAJOR = 24;

export function checkNodeVersion(version = process.versions.node, pinned = readPinned()) {
  const major = Number.parseInt(version.split(".")[0], 10);
  if (major !== REQUIRED_MAJOR) {
    return {
      ok: false,
      message:
        `Node ${version} is not allowed: this project runs on Node ${REQUIRED_MAJOR}.x (pinned ${pinned}). ` +
        "Run through pnpm (pnpm run …, pnpm exec node …) so devEngines.runtime supplies it, " +
        "or fall back to `fnm exec --using=.node-version` (docs/arch/ADR-003).",
    };
  }
  const note = version === pinned ? "" : ` (pinned ${pinned}; patch differs)`;
  return { ok: true, message: `Node ${version} OK${note}` };
}

function readPinned() {
  try {
    return readFileSync(join(ROOT, ".node-version"), "utf8").trim();
  } catch {
    return "24.x";
  }
}

if (isMain(import.meta.url)) {
  const result = checkNodeVersion();
  (result.ok ? console.log : console.error)(`check-node: ${result.message}`);
  process.exit(result.ok ? 0 : 1);
}
