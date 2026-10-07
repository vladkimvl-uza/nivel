// A whole admin without PostgreSQL and without Next.js, for the tests of the server actions: the real services over
// in-memory stores, a cookie jar in place of `next/headers`. Not part of the application.
import { randomBytes } from "node:crypto";
import type { AuditSink } from "../../auth/audit.ts";
import { createNodeArgon2Hasher } from "../../auth/password.ts";
import { SESSION_COOKIE } from "../../auth/policy.ts";
import type { Role } from "../../auth/roles.ts";
import type { Runtime } from "../../auth/runtime.ts";
import { createAuthService } from "../../auth/service.ts";
import { MemoryAuthStore } from "../../auth/store.memory.ts";
import type { AuditEntry } from "../../auth/store.ts";
import { base32Decode, generateTotp } from "../../auth/totp.ts";
import { type CatalogValue, createCatalogResource, productKey } from "../catalog/resource.ts";
import type { ListQuery, ResourceStore, StoredRecord, WriteContext } from "../resource.ts";
import { createSettingsService, type SettingsStore } from "../settings/service.ts";
import type { FileRegistry, RegisteredFile } from "../upload/save.ts";

/** Cookies and request headers of the call being tested. */
export const jar = new Map<string, string>();
export const requestHeaders = new Headers();

export interface CookieWrite {
  name: string;
  value: string;
  options: Record<string, unknown> | undefined;
}
/** Every Set-Cookie of the call being tested, with its attributes: the browser acts on them, not on the jar. */
export const cookieWrites: CookieWrite[] = [];

/** What `redirect()` of Next.js does: it throws; the test catches it and reads where to. */
export class RedirectSignal extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`redirect to ${url}`);
    this.url = url;
  }
}

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieWrites.push({ name, value, options });
      // A browser drops a cookie that is set with Max-Age=0. A `__Host-` cookie without Secure is not accepted at all,
      // not even to be removed (RFC 6265bis 4.1.3.2): that write changes nothing.
      const accepted = !name.startsWith("__Host-") || options?.secure === true;
      if (!accepted) return;
      if (options?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    // No `delete`: Next.js writes it without Secure, which a browser refuses for a `__Host-` cookie. Use `set`.
  }),
  headers: async () => requestHeaders,
};

export class MemorySettingsStore implements SettingsStore {
  readonly data = new Map<string, { value: unknown; version: number }>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: unknown, _by: string, opts: { expectedVersion?: number } = {}) {
    const current = this.data.get(key);
    if (opts.expectedVersion !== undefined && (current?.version ?? 0) !== opts.expectedVersion) {
      throw new Error("stale_status: changed meanwhile");
    }
    const version = (current?.version ?? 0) + 1;
    this.data.set(key, { value, version });
    return { version };
  }
  async setMany(changes: { key: string; value: unknown }[], by: string) {
    for (const c of changes) await this.set(c.key, c.value, by);
  }
}

export class MemoryCatalogStore implements ResourceStore<CatalogValue> {
  readonly rows = new Map<string, CatalogValue>();
  private seq = 0;
  async list(q: ListQuery) {
    const all = [...this.rows.entries()].map(([id, value]) => ({ id, value }));
    return { rows: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: all.length };
  }
  async get(id: string): Promise<StoredRecord<CatalogValue> | null> {
    const value = this.rows.get(id);
    return value ? { id, value } : null;
  }
  async create(value: CatalogValue, ctx: WriteContext) {
    this.seq += 1;
    const id = `p${this.seq}`;
    this.rows.set(id, value);
    await ctx.audit({ action: "create", entityId: id, after: value });
    return { id };
  }
  async update(id: string, value: CatalogValue, ctx: WriteContext) {
    const before = this.rows.get(id);
    this.rows.set(id, value);
    await ctx.audit({ action: "update", entityId: id, before, after: value });
  }
  async findByKey(value: CatalogValue) {
    return [...this.rows.entries()].find(([, v]) => productKey(v) === productKey(value))?.[0] ?? null;
  }
}

const FEE = {
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
};

export const PASSWORD = "correct-horse-battery-staple";

export function createFakeApp() {
  jar.clear();
  cookieWrites.length = 0;
  for (const key of [...requestHeaders.keys()]) requestHeaders.delete(key);

  const authStore = new MemoryAuthStore();
  const dataKey = randomBytes(32);
  const auth = createAuthService({
    store: authStore,
    hasher: createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 }),
    dataKey,
    issuer: "Nivel admin",
  });
  const audit: AuditEntry[] = [];
  const auditSink: AuditSink = {
    async append(entry) {
      audit.push(entry);
    },
  };
  const settingsStore = new MemorySettingsStore();
  settingsStore.data.set("money.fee_settings", { value: FEE, version: 1 });
  settingsStore.data.set("money.threshold", {
    value: {
      annualLimit: 1_000_000_000,
      planCap: 200_000_000,
      alertsBp: [6000, 10000],
      proportion: "without_registration_day",
    },
    version: 1,
  });
  settingsStore.data.set("calendar.work", {
    value: { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] },
    version: 1,
  });
  const revalidations: string[][] = [];
  const settings = createSettingsService({
    store: settingsStore,
    revalidator: {
      async revalidate(tags) {
        revalidations.push(tags);
        return { ok: true };
      },
    },
  });
  const catalogStore = new MemoryCatalogStore();
  const catalog = createCatalogResource(catalogStore, auditSink);
  const storedFiles = new Map<string, Buffer>();
  const registered = new Map<string, RegisteredFile & { id: string }>();
  const registry: FileRegistry = {
    async register(file) {
      const existing = registered.get(file.storageKey);
      if (existing) return { id: existing.id, duplicate: true };
      const id = `f${registered.size + 1}`;
      registered.set(file.storageKey, { ...file, id });
      return { id, duplicate: false };
    },
  };

  const runtime = {
    env: {},
    db: undefined,
    audit: auditSink,
    auth,
    settings,
    catalog,
    upload: {
      files: {
        async put(key: string, data: Buffer) {
          storedFiles.set(key, data);
        },
      },
      registry,
      audit: auditSink,
    },
    hashIp: (ip: string) => `hash(${ip})`,
  } as unknown as Runtime;

  /** Creates a person and puts a live session cookie into the jar, as a sign-in would. */
  async function signInAs(role: Role, email = `${role}@nivel.test`) {
    const made = await auth.provisionUser({ email, role, password: PASSWORD, actor: "test" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const secret = base32Decode(made.totpSecret);
    const result = await auth.login({
      email,
      password: PASSWORD,
      code: generateTotp(secret, new Date()),
      ipHash: null,
      ua: null,
    });
    if (!result.ok) throw new Error("sign-in failed");
    jar.set(SESSION_COOKIE, result.token);
    return { user: result.user, token: result.token, password: PASSWORD, secret, recoveryCodes: made.recoveryCodes };
  }

  return { runtime, authStore, settingsStore, catalogStore, audit, revalidations, storedFiles, registered, signInAs };
}

export type FakeApp = ReturnType<typeof createFakeApp>;

export function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) data.append(k, item);
  return data;
}
