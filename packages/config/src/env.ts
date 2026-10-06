import { z } from "zod";

/** Applications and one-off processes that read environment variables. */
export type AppName = "web" | "admin" | "bot" | "worker" | "migrator";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalText = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const pgUrl = z.string().regex(/^postgres(ql)?:\/\/[^\s]+$/, "must be a postgres:// URL");
const secret = z.string().min(32, "must be at least 32 characters (pnpm env:init generates one)");
/** AES-256 key: exactly 32 bytes as padded base64 (42 chars + one of 16 final chars + "="), no Buffer needed. */
const aes256Key = z
  .string()
  .regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/, "must be 32 random bytes in base64 (pnpm env:init generates one)");
const httpUrl = z.url({ protocol: /^https?$/ });
const flag = z.preprocess(emptyToUndefined, z.stringbool().default(false));

const common = {
  APP_MODE: z.preprocess(emptyToUndefined, z.enum(["development", "staging", "production"]).default("development")),
  NIVEL_SLOT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(9).default(0)),
};

const ownerIds = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.split(",").map((s) => s.trim()) : []),
  z.array(z.string().regex(/^\d+$/, "Telegram user id must be digits")),
);

export const envSchemas = {
  web: z.object({
    ...common,
    DATABASE_URL_WEB: pgUrl,
    PUBLIC_BASE_URL: httpUrl,
    REVALIDATE_HMAC_KEY: secret,
    TMA_TOKEN_KEY: z.preprocess(emptyToUndefined, secret.optional()),
    ANTHROPIC_API_KEY: optionalText,
    AI_ENABLED: flag,
    MEDIA_DIR: optionalText,
  }),
  admin: z.object({
    ...common,
    DATABASE_URL_ADMIN: pgUrl,
    PUBLIC_BASE_URL: httpUrl,
    ADMIN_BASE_URL: httpUrl,
    DATA_ENC_KEY: aes256Key,
    REVALIDATE_HMAC_KEY: secret,
    FILES_DIR: optionalText,
  }),
  bot: z
    .object({
      ...common,
      DATABASE_URL_BOT: pgUrl,
      BOT_TOKEN: optionalText,
      BOT_MODE: z.preprocess(emptyToUndefined, z.enum(["polling", "webhook"]).default("polling")),
      BOT_WEBHOOK_SECRET: optionalText,
      TELEGRAM_OWNER_IDS: ownerIds,
      PUBLIC_BASE_URL: httpUrl,
    })
    .refine((e) => e.BOT_MODE !== "webhook" || e.BOT_WEBHOOK_SECRET !== undefined, {
      message: "BOT_WEBHOOK_SECRET is required when BOT_MODE=webhook",
      path: ["BOT_WEBHOOK_SECRET"],
    }),
  worker: z.object({
    ...common,
    DATABASE_URL_WORKER: pgUrl,
    PUBLIC_BASE_URL: httpUrl,
    REVALIDATE_HMAC_KEY: secret,
    BOT_TOKEN: optionalText,
    FILES_DIR: optionalText,
  }),
  migrator: z.object({
    ...common,
    DATABASE_URL_MIGRATOR: pgUrl,
  }),
} as const;

export type Env<A extends AppName> = z.infer<(typeof envSchemas)[A]>;

export class EnvError extends Error {
  readonly issues: readonly string[];
  constructor(app: AppName, issues: readonly string[]) {
    super(`Invalid environment for "${app}":\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

/** Validates process environment for one application; throws EnvError listing every problem. */
export function loadEnv<A extends AppName>(app: A, source: Record<string, string | undefined> = process.env): Env<A> {
  const result = envSchemas[app].safeParse(source);
  if (!result.success) {
    throw new EnvError(
      app,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data as Env<A>;
}

export const APP_PORT_OFFSET = { web: 0, admin: 1, worker: 2, bot: 3 } as const;

/** PORT_BASE = 3100 + 100 × slot; web +0, admin +1, worker +2, bot +3 (ARCHITECTURE 2.3). */
export function appPort(app: keyof typeof APP_PORT_OFFSET, slot: number): number {
  return 3100 + 100 * slot + APP_PORT_OFFSET[app];
}
