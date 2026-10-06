// Full local CI (ARCHITECTURE 11.4), works without GitHub. Usage: pnpm ci:local [--skip step,step] [--only step]
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { prepareStandalone } from "./e2e.mjs";
import { appPort, isGitWorktree, isMain, loadRootEnv, ROOT, slotFromEnv } from "./lib/env.mjs";

const node = (script, ...args) => ({ cmd: process.execPath, args: [join(ROOT, "tools", script), ...args] });
const pnpm = (...args) => ({ cmd: "pnpm", args, shell: true });

/** Starts the standalone server of an app and expects GET /healthz → 200 (image layout spike). */
async function standaloneSmoke(app) {
  const dir = prepareStandalone(app);
  const port = appPort(app, slotFromEnv());
  const child = spawn(process.execPath, [join(dir, "server.js")], {
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (res.status === 200) {
          console.log(`  standalone ${app}: GET /healthz → 200 ${JSON.stringify(await res.json())}`);
          return true;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error(`  standalone ${app}: /healthz did not answer 200 within 30 s`);
    return false;
  } finally {
    child.kill();
  }
}

/**
 * gitleaks reads the history inside a container that cannot follow a worktree's `.git` file: there it would scan
 * nothing and still pass, so in a worktree the step says it is skipped. Branch commits are scanned at merge into main.
 */
function gitleaks() {
  if (isGitWorktree()) {
    console.log(
      "  gitleaks: skipped in a worktree (the container cannot read .git/worktrees); scanned at merge into main",
    );
    return true;
  }
  const r = spawnSync("pnpm", ["run", "gitleaks"], { stdio: "inherit", cwd: ROOT, shell: true });
  return r.status === 0;
}

export const STEPS = [
  ["node", node("check-node.mjs")],
  ["install", pnpm("install", "--frozen-lockfile")],
  ["biome", pnpm("exec", "biome", "check", ".")],
  ["deps", node("check-deps.mjs")],
  ["ownership", node("check-ownership.mjs")],
  ["antilist", node("check-antilist.mjs")],
  ["uz-text", node("check-uz-text.mjs")],
  ["messages", node("check-messages.mjs")],
  ["typecheck", pnpm("run", "typecheck")],
  ["unit", pnpm("run", "test")],
  ["test-db", pnpm("run", "infra:test:up")],
  ["integration", pnpm("run", "test:int")],
  ["build", pnpm("run", "build")],
  ["ports", node("check-ports.mjs")],
  ["standalone", { fn: () => standaloneSmoke("admin") }],
  ["bundle-budget", node("check-bundle-budget.mjs")],
  ["e2e", node("e2e.mjs")],
  ["demo", node("check-demo.mjs")],
  ["gitleaks", { fn: gitleaks }],
];

async function runStep([name, step]) {
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  let ok;
  if (step.fn) ok = await step.fn();
  else {
    const r = spawnSync(step.cmd, step.args, {
      stdio: "inherit",
      cwd: ROOT,
      shell: step.shell ?? false,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI_LOCAL: "1" },
    });
    ok = r.status === 0;
  }
  const s = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "✔" : "✖"} ${name} (${s} s)`);
  return { name, ok, s };
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const { values } = parseArgs({ options: { skip: { type: "string" }, only: { type: "string" } } });
  const skip = new Set((values.skip ?? "").split(",").filter(Boolean));
  const only = values.only ? new Set(values.only.split(",")) : null;
  const started = Date.now();
  const results = [];
  for (const step of STEPS) {
    if (skip.has(step[0]) || (only && !only.has(step[0]))) {
      results.push({ name: step[0], ok: true, s: "skipped" });
      continue;
    }
    const r = await runStep(step);
    results.push(r);
    if (!r.ok) break;
  }
  const total = ((Date.now() - started) / 60000).toFixed(1);
  console.log("\nci:local summary");
  for (const r of results)
    console.log(`  ${r.ok ? "✔" : "✖"} ${r.name.padEnd(14)} ${r.s}${r.s === "skipped" ? "" : " s"}`);
  const failed = results.find((r) => !r.ok);
  console.log(failed ? `✖ FAILED at ${failed.name} (${total} min)` : `✔ GREEN (${total} min)`);
  process.exit(failed ? 1 : 0);
}
