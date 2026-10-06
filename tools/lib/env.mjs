// Shared helpers for tools: repo root, .env.local loading, slot and ports.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** True in a git worktree: there `.git` is a file pointing at the main repository (the gitleaks container cannot follow it). */
export function isGitWorktree(root = ROOT) {
  try {
    return statSync(join(root, ".git")).isFile();
  } catch {
    return false;
  }
}

/** Parses a dotenv file into an object (no expansion, no multiline values). */
export function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Loads <root>/.env.local into process.env without overriding variables already set. */
export function loadRootEnv(root = ROOT) {
  const values = parseEnvFile(join(root, ".env.local"));
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return values;
}

export function slotFromEnv(env = process.env) {
  const raw = env.NIVEL_SLOT ?? "0";
  const slot = Number.parseInt(raw === "" ? "0" : raw, 10);
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) {
    throw new Error(`NIVEL_SLOT must be an integer 0..9, got "${raw}"`);
  }
  return slot;
}

export const APP_PORT_OFFSETS = { web: 0, admin: 1, worker: 2, bot: 3 };

export function portBase(slot) {
  return 3100 + 100 * slot;
}

export function appPort(app, slot) {
  const offset = APP_PORT_OFFSETS[app];
  if (offset === undefined) throw new Error(`Unknown app "${app}"`);
  return portBase(slot) + offset;
}

/** True when the module is the script node was started with (not imported by a test). */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return resolve(fileURLToPath(metaUrl)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
}
