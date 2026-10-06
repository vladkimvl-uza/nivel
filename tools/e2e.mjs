// Runs Playwright e2e against the standalone web build. No browser downloads: uses the bundled Chromium when
// it is installed, otherwise Microsoft Edge from Windows (channel "msedge").
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMain, loadRootEnv, ROOT } from "./lib/env.mjs";

export function bundledChromiumInstalled() {
  try {
    const req = createRequire(join(ROOT, "node_modules", "@playwright", "test", "package.json"));
    const core = req.resolve("playwright-core/package.json");
    const browsers = JSON.parse(readFileSync(join(core, "..", "browsers.json"), "utf8")).browsers;
    const rev = browsers.find((b) => b.name === "chromium")?.revision;
    const base =
      process.env.PLAYWRIGHT_BROWSERS_PATH ||
      (process.platform === "win32"
        ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ms-playwright")
        : join(homedir(), ".cache", "ms-playwright"));
    return rev ? existsSync(join(base, `chromium-${rev}`)) : false;
  } catch {
    return false;
  }
}

export function edgeInstalled() {
  if (process.platform !== "win32") return false;
  return [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
    .filter(Boolean)
    .some((p) => existsSync(join(p, "Microsoft", "Edge", "Application", "msedge.exe")));
}

/**
 * Windows only: Next 16 copies pnpm's package links into .next/standalone as *file* symlinks that point to
 * directories, and Node then fails with EPERM on stat. Replaces every symlink to a directory with a junction
 * (no privilege needed). Linux images keep real directory symlinks, so this is a no-op there.
 * Returns the number of links replaced.
 */
export function junctionizeSymlinks(dir) {
  if (process.platform !== "win32" || !existsSync(dir)) return 0;
  let replaced = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = resolve(dirname(full), readlinkSync(full));
        let isDir = false;
        try {
          isDir = statSync(target).isDirectory();
        } catch {}
        if (isDir) {
          unlinkSync(full);
          symlinkSync(target, full, "junction");
          replaced += 1;
        }
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(dir);
  return replaced;
}

/** next build (standalone) leaves static assets outside the standalone folder; the image build copies them too. */
export function prepareStandalone(app) {
  const appDir = join(ROOT, "apps", app);
  const standalone = join(appDir, ".next", "standalone", "apps", app);
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error(`apps/${app}: no standalone build, run pnpm build first`);
  }
  junctionizeSymlinks(join(appDir, ".next", "standalone"));
  rmSync(join(standalone, ".next", "static"), { recursive: true, force: true });
  cpSync(join(appDir, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
  if (existsSync(join(appDir, "public")))
    cpSync(join(appDir, "public"), join(standalone, "public"), { recursive: true });
  return standalone;
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  prepareStandalone("web");
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  if (!bundledChromiumInstalled()) {
    if (!edgeInstalled()) {
      console.error("e2e: no browser (bundled Chromium is not installed and Edge is missing); not downloading one");
      process.exit(1);
    }
    env.PW_CHANNEL = "msedge";
    console.log("e2e: bundled Chromium not installed, using Microsoft Edge (channel msedge)");
  }
  const bin = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
  const r = spawnSync(process.execPath, [bin, "test", ...process.argv.slice(2)], { stdio: "inherit", env, cwd: ROOT });
  process.exit(r.status ?? 1);
}
