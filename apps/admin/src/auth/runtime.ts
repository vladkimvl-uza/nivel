// The one place where the admin is put together from its parts: the environment, the connection of the role
// nivel_admin, the services. Server only. Built on the first request (not at import: `next build` has no environment),
// kept on globalThis so that hot reload in development does not open a pool per edit.
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { type Env, loadEnv } from "@nivel/config/env";
import { createDb, type Db } from "@nivel/db";
import { createCatalogResource } from "../kit/catalog/resource.ts";
import { createPgCatalogStore } from "../kit/catalog/store.pg.ts";
import { createHttpRevalidator, createSettingsService, type SettingsService } from "../kit/settings/service.ts";
import { createPgRevalidateRetry, createPgSettingsStore } from "../kit/settings/store.pg.ts";
import { createLazySharpSanitizer, type SharpFactory } from "../kit/upload/image.ts";
import { createPgFileRegistry } from "../kit/upload/registry.pg.ts";
import { createFsFileSink, type UploadDeps } from "../kit/upload/save.ts";
import { type AuditSink, createPgAuditSink } from "./audit.ts";
import { createNodeArgon2Hasher } from "./password.ts";
import { parseDataKey } from "./secrets.ts";
import { type AuthService, createAuthService } from "./service.ts";
import { createPgAuthStore } from "./store.pg.ts";

export interface Runtime {
  env: Env<"admin">;
  db: Db;
  audit: AuditSink;
  auth: AuthService;
  settings: SettingsService;
  catalog: ReturnType<typeof createCatalogResource>;
  upload: UploadDeps;
  /** Hash of an address for the journal: the address itself is personal data and is never stored. */
  hashIp(ip: string): string;
}

const KEY = Symbol.for("nivel.admin.runtime");

/**
 * sharp reads the HEIF family and turns and re-encodes phone photos (kit/upload/image.ts). It is a native module kept
 * out of the bundle (`serverExternalPackages`), loaded on the first picture that needs it. Two threads and no cache: the
 * container has 384 MB and cleaning is limited to two pictures at once.
 */
async function loadSharp(): Promise<SharpFactory> {
  const sharp = (await import("sharp")).default;
  sharp.cache(false);
  sharp.concurrency(2);
  return sharp;
}

export function getRuntime(): Runtime {
  const holder = globalThis as unknown as Record<symbol, Runtime | undefined>;
  const existing = holder[KEY];
  if (existing) return existing;

  const env = loadEnv("admin", process.env);
  const db = createDb(env.DATABASE_URL_ADMIN, { max: 8, applicationName: "nivel-admin" });
  const dataKey = parseDataKey(env.DATA_ENC_KEY);
  const audit = createPgAuditSink(db);
  const runtime: Runtime = {
    env,
    db,
    audit,
    auth: createAuthService({
      store: createPgAuthStore(db),
      hasher: createNodeArgon2Hasher(),
      dataKey,
      issuer: "Nivel admin",
    }),
    settings: createSettingsService({
      store: createPgSettingsStore(db),
      revalidator: createHttpRevalidator({ baseUrl: env.PUBLIC_BASE_URL, key: env.REVALIDATE_HMAC_KEY }),
      outbox: createPgRevalidateRetry(db),
    }),
    catalog: createCatalogResource(createPgCatalogStore(db), audit),
    upload: {
      files: createFsFileSink(env.FILES_DIR ?? join(process.cwd(), ".data", "files")),
      registry: createPgFileRegistry(db),
      audit,
      fallback: createLazySharpSanitizer(loadSharp),
    },
    hashIp: (ip) => createHmac("sha256", dataKey).update(`ip:${ip}`).digest("hex").slice(0, 32),
  };
  holder[KEY] = runtime;
  return runtime;
}
