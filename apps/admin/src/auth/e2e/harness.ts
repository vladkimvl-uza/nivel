// Harness of the browser tests of the admin (e2e/admin-*.spec.ts). Not part of the application.
//
// One harness per Playwright worker: its own database cloned from the test template (never the dev database), its own
// folder for files, a stand-in for the site that records the cache calls, and the real standalone build of the admin
// started on a port of the slot. Users are created through the same service the admin uses, so a test signs in exactly
// as a person would.
import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, type Db } from "@nivel/db";
import { createWorkerDatabase, prepareTemplate, type WorkerDatabase } from "@nivel/testing";
import { createNodeArgon2Hasher } from "../password.ts";
import type { Role } from "../roles.ts";
import { parseDataKey } from "../secrets.ts";
import { type AuthService, createAuthService } from "../service.ts";
import { createPgAuthStore } from "../store.pg.ts";
import { base32Decode, generateTotp } from "../totp.ts";

export interface WebCall {
  tags: string[];
  /** The signature matched the key and the timestamp was fresh. */
  valid: boolean;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  recoveryCodes: string[];
  /** The code the authenticator app would show now. */
  code(): string;
}

export interface AdminHarness {
  baseURL: string;
  filesDir: string;
  webCalls: WebCall[];
  /** Plain SQL on the database of this harness (as the admin role). */
  query<R extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]>;
  createUser(role: Role, opts?: { email?: string; password?: string }): Promise<TestUser>;
  stop(): Promise<void>;
}

const ROOT = process.cwd();
const standalone = () => join(ROOT, "apps", "admin", ".next", "standalone", "apps", "admin");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (pnpm env:init)`);
  return v;
}

/**
 * The test cluster of the machine lives in 256 MB of memory shared by every worktree: eight workers with a database
 * of ten megabytes each filled it once and the server went down. At most `SLOTS` harnesses exist at a time; a worker
 * that has no slot waits for one. A lock is a folder with the PID of its owner, taken over when the owner is gone.
 */
const SLOTS = 2;

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
    // Once: a second call must not remove the lock of whoever took the place meanwhile.
    if (released) return;
    released = true;
    rmSync(dir, { recursive: true, force: true });
  };
}

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
      throw new Error(`no free place for the admin e2e (${names.join(", ")}) in ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * `next build` leaves the static files outside the standalone folder and, on Windows, pnpm links that Node cannot read;
 * `prepareStandalone` of tools/e2e.mjs (the same one the CI uses for the site) puts both right. Several workers start
 * together, so the first one prepares under a lock and the rest wait for its marker.
 */
async function ensureStatic(): Promise<void> {
  const server = join(standalone(), "server.js");
  if (!existsSync(server)) throw new Error("apps/admin has no standalone build: run `pnpm build` first");
  const marker = join(standalone(), ".e2e-prepared");
  if (existsSync(marker)) return;
  try {
    mkdirSync(`${marker}.lock`);
  } catch {
    const deadline = Date.now() + 120_000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
    return;
  }
  const tools = (await import(pathToFileURL(join(ROOT, "tools", "e2e.mjs")).href)) as {
    prepareStandalone(app: string): string;
  };
  tools.prepareStandalone("admin");
  writeFileSync(marker, "1");
}

function startFakeSite(port: number, key: string, calls: WebCall[]): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const timestamp = String(req.headers["x-nivel-timestamp"] ?? "");
      const given = Buffer.from(String(req.headers["x-nivel-signature"] ?? ""), "utf8");
      const expected = Buffer.from(createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex"), "utf8");
      const fresh = Math.abs(Date.now() - Number(timestamp)) < 5 * 60_000;
      const valid = fresh && given.length === expected.length && timingSafeEqual(given, expected);
      if (req.url === "/api/internal/revalidate" && req.method === "POST") {
        try {
          calls.push({ tags: (JSON.parse(body) as { tags: string[] }).tags, valid });
        } catch {
          calls.push({ tags: [], valid: false });
        }
        res.writeHead(valid ? 200 : 401, { "content-type": "application/json" }).end("{}");
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForHealth(url: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the admin exited with ${child.exitCode}:\n${log()}`);
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`the admin did not answer /healthz in 60 s:\n${log()}`);
}

const SEED_SETTINGS: Record<string, unknown> = {
  "money.fee_settings": {
    version: "2026-10-05",
    effectiveFrom: "2026-10-05",
    pcLowRateBp: 1500,
    pcHighRateBp: 1000,
    pcThreshold: 20_000_000,
    pcHighMinFee: 3_000_000,
    mountRateBp: 1500,
    complexRateBp: 1500,
    minFullCyclePc: 6_700_000,
    minFreeWindowPc: 4_500_000,
    minFullCycleSetup: 13_300_000,
    stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
    commissionLineStages: ["selection", "purchase"],
    advanceBp: 3000,
    reserveBp: 300,
    reserveHighBp: 500,
    reserveHighShareBp: 2500,
    reserveRoundStep: 10_000,
    podborShareBp: 2000,
    podborCreditDays: 30,
    afterTestsRetainBp: 8500,
    shelfLifeHours: { components: 24, furniture: 72 },
  },
  "money.threshold": {
    annualLimit: 1_000_000_000,
    planCap: 200_000_000,
    alertsBp: [6000, 7000, 8000, 9000, 10000],
    proportion: "without_registration_day",
  },
  "calendar.work": { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] },
  "feature.ai": false,
  "feature.setupConfigurator": false,
  "feature.scene": false,
  "feature.miniApp": false,
};

export async function startAdminHarness(parallelIndex: number): Promise<AdminHarness> {
  await ensureStatic();
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

async function boot(parallelIndex: number, releaseSlot: () => void): Promise<AdminHarness> {
  const dataKey = required("DATA_ENC_KEY");
  const hmacKey = required("REVALIDATE_HMAC_KEY");
  const slot = Number(process.env.NIVEL_SLOT ?? "0");
  const portBase = 3100 + 100 * slot;
  const adminPort = portBase + 10 + 2 * parallelIndex;
  const sitePort = portBase + 11 + 2 * parallelIndex;

  // The template is built once, by whoever comes first; the others find it ready.
  const releaseTemplate = await acquire(["template"], 5 * 60_000);
  try {
    await prepareTemplate();
  } finally {
    releaseTemplate();
  }
  const database: WorkerDatabase = await createWorkerDatabase(`adm${parallelIndex}`, process.env, {});
  const db: Db = createDb(database.urls.ADMIN, { max: 3 });
  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    await db.$client.query("insert into ops.settings (key, value, updated_by) values ($1, $2, 'e2e')", [
      key,
      JSON.stringify(value),
    ]);
  }
  await db.$client.query(
    `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
     values ('gpu', 'pc', '{"uz":"Videokarta","ru":"Видеокарта"}', 'pc', 3, true, 5),
            ('ram', 'pc', '{"uz":"Operativ xotira","ru":"Оперативная память"}', 'pc', 7, true, 3)`,
  );

  const auth: AuthService = createAuthService({
    store: createPgAuthStore(db),
    hasher: createNodeArgon2Hasher({ memoryKiB: 4096, passes: 1 }),
    dataKey: parseDataKey(dataKey),
    issuer: "Nivel admin",
  });

  const webCalls: WebCall[] = [];
  const site = await startFakeSite(sitePort, hmacKey, webCalls);
  const filesDir = mkdtempSync(join(tmpdir(), "nivel-admin-e2e-"));
  const baseURL = `http://127.0.0.1:${adminPort}`;

  let output = "";
  const child = spawn(process.execPath, [join(standalone(), "server.js")], {
    cwd: standalone(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(adminPort),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_MODE: "development",
      DATABASE_URL_ADMIN: database.urls.ADMIN,
      DATABASE_URL_WEB: database.urls.WEB,
      DATABASE_URL_BOT: database.urls.BOT,
      DATABASE_URL_WORKER: database.urls.WORKER,
      DATA_ENC_KEY: dataKey,
      REVALIDATE_HMAC_KEY: hmacKey,
      PUBLIC_BASE_URL: `http://127.0.0.1:${sitePort}`,
      ADMIN_BASE_URL: baseURL,
      FILES_DIR: filesDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString();
  });

  const harness: AdminHarness = {
    baseURL,
    filesDir,
    webCalls,
    async query(text, params = []) {
      const { rows } = await db.$client.query(text, params);
      return rows;
    },
    async createUser(role, opts = {}) {
      const email = opts.email ?? `${role}-${Math.random().toString(36).slice(2, 8)}@nivel.test`;
      const password = opts.password ?? "correct-horse-battery-staple";
      const made = await auth.provisionUser({ email, role, password, actor: "e2e" });
      if (!made.ok) throw new Error(made.problems.join(" "));
      const secret = base32Decode(made.totpSecret);
      return {
        id: made.id,
        email: made.email,
        password,
        role,
        recoveryCodes: made.recoveryCodes,
        code: () => generateTotp(secret, new Date()),
      };
    },
    async stop() {
      child.kill();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      await db.$client.end().catch(() => {});
      await database.drop().catch(() => {});
      rmSync(filesDir, { recursive: true, force: true });
      releaseSlot();
    },
  };

  try {
    await waitForHealth(baseURL, child, () => output);
    // The first request to each kind of page loads its code: do it before the tests start counting seconds.
    for (const path of ["/sign-in", "/forbidden", "/catalog", "/catalog/template?category=gpu", "/journal"]) {
      await fetch(`${baseURL}${path}`, { redirect: "manual" }).catch(() => {});
    }
  } catch (error) {
    await harness.stop(); // also gives the place back
    throw error;
  }
  return harness;
}
