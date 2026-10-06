// Loads the Apps Script sources into a node:vm context, in the order of their numeric prefix (as the bundle does).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Source files of the project in load order. */
export function sourceFiles() {
  return readdirSync(SRC_DIR)
    .filter((f) => /^\d\d_.+\.js$/.test(f))
    .sort();
}

/** Creates a context with the given globals and runs every source file in it. Returns the context object. */
export function loadSources(globals = {}, files = sourceFiles()) {
  // Built-ins (Date, BigInt, JSON, ...) come from the new context itself; only console is shared.
  const sandbox = { console, ...globals };
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(readFileSync(join(SRC_DIR, f), "utf8"), ctx, { filename: f });
  }
  return ctx;
}

/** Runs an expression in the context (handy for const-declared names, which are not properties of the context). */
export function evalIn(ctx, code) {
  return vm.runInContext(code, ctx);
}
