// Harness of the browser test of the request form with a database (e2e/site-lead-flow.spec.ts). Not part of the application.
//
// One harness per Playwright worker: its own database cloned from the test template (never the dev database) and the real
// standalone build of the site started on a port of the slot, connected to that database with the role `web`. It takes one of
// the places that the harness of the admin takes too (the test cluster lives in 256 MB shared by every worktree).
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@nivel/db";
import { createWorkerDatabase, prepareTemplate, type WorkerDatabase } from "@nivel/testing";

export interface SiteHarness {
  baseURL: string;
  /** Plain SQL on the database of this harness (as the admin role: it can read what the site cannot). */
  query<R extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]>;
  stop(): Promise<void>;
}

const ROOT = process.cwd();
const standalone = () => join(ROOT, "apps", "web", ".next", "standalone", "apps", "web");
const SLOTS = 2;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (pnpm env:init)`);
  return v;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only asks whether the process exists
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryLock(dir: string): (() => void) | null {
  try {
    mkdirSync(dir);
  } catch {
    try {
      if (!alive(Number(readFileSync(join(dir, "pid"), "utf8")))) rmSync(dir, { recursive: true, force: true });
    } catch {
      // the owner is just writing its PID, or the folder is gone: the next round decides
    }
    return null;
  }
  writeFileSync(join(dir, "pid"), String(process.pid));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(dir, { recursive: true, force: true });
  };
}

/** The same folder of locks as the harness of the admin: the two share the places and the building of the template. */
async function acquire(names: string[], timeoutMs: number): Promise<() => void> {
  const root = join(tmpdir(), `nivel-admin-e2e-locks-${process.env.NIVEL_SLOT ?? "0"}`);
  mkdirSync(root, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const name of names) {
      const release = tryLock(join(root, name));
      if (release) return release;
    }
    if (Date.now() > deadline)
      throw new Error(`no free place for the site e2e (${names.join(", ")}) in ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function waitForHealth(url: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the site exited with ${child.exitCode}:\n${log()}`);
    try {
      if ((await fetch(`${url}/healthz`)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`the site did not answer /healthz in 60 s:\n${log()}`);
}

export async function startSiteHarness(parallelIndex: number): Promise<SiteHarness> {
  if (!existsSync(join(standalone(), "server.js"))) {
    throw new Error("apps/web has no standalone build: run `pnpm build` first");
  }
  const releaseSlot = await acquire(
    Array.from({ length: SLOTS }, (_, i) => `slot-${i}`),
    15 * 60_000,
  );
  try {
    return await boot(parallelIndex, releaseSlot);
  } catch (error) {
    releaseSlot();
    throw error;
  }
}

async function boot(parallelIndex: number, releaseSlot: () => void): Promise<SiteHarness> {
  const slot = Number(process.env.NIVEL_SLOT ?? "0");
  const port = 3100 + 100 * slot + 20 + parallelIndex;
  const releaseTemplate = await acquire(["template"], 5 * 60_000);
  try {
    await prepareTemplate();
  } finally {
    releaseTemplate();
  }
  const database: WorkerDatabase = await createWorkerDatabase(`web${parallelIndex}`, process.env, {});
  const db: Db = createDb(database.urls.ADMIN, { max: 2 });
  // the form is switched off by default (feature.webLeadForm): this site has the services, so it is switched on
  await db.$client.query(
    "insert into ops.settings (key, value) values ('feature.webLeadForm', 'true'::jsonb) on conflict (key) do update set value = excluded.value",
  );
  const baseURL = `http://127.0.0.1:${port}`;

  let output = "";
  const child = spawn(process.execPath, [join(standalone(), "server.js")], {
    cwd: standalone(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_MODE: "development",
      DATABASE_URL_WEB: database.urls.WEB,
      DATABASE_URL_ADMIN: database.urls.ADMIN,
      DATABASE_URL_BOT: database.urls.BOT,
      DATABASE_URL_WORKER: database.urls.WORKER,
      DATA_ENC_KEY: required("DATA_ENC_KEY"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString();
  });

  const harness: SiteHarness = {
    baseURL,
    async query(text, params = []) {
      const { rows } = await db.$client.query(text, params);
      return rows;
    },
    async stop() {
      child.kill();
      await db.$client.end().catch(() => {});
      await database.drop().catch(() => {});
      releaseSlot();
    },
  };
  try {
    await waitForHealth(baseURL, child, () => output);
  } catch (error) {
    await harness.stop();
    throw error;
  }
  return harness;
}
