// Settings of the owner: money with a version and a date of entry into force, thresholds, the calendar with holidays
// and response hours, feature flags (ARCHITECTURE 6.3). Every change is journaled by the store (ops.setSetting writes
// the audit row in the same transaction) and ends with a request to the site to drop its cache tag `settings`.
import { createHmac } from "node:crypto";
import { type Permission, requirePermission } from "../../auth/roles.ts";
import type { SessionUser } from "../../auth/service.ts";
import { formatIssues } from "../form.ts";
import {
  CalendarSettingsSchema,
  FEATURE_FLAGS,
  FeeSettingsSchema,
  nextVersionName,
  SETTING_KEYS,
  ThresholdSettingsSchema,
} from "./schemas.ts";

// ---- ports ------------------------------------------------------------------------------------------------------

export interface SettingRead {
  value: unknown;
  version: number;
}

export interface SettingsStore {
  get(key: string): Promise<SettingRead | null>;
  /** Writes one key and journals it. With `expectedVersion` the write is refused when the key changed meanwhile. */
  set(
    key: string,
    value: unknown,
    by: string,
    opts?: { expectedVersion?: number; ipHash?: string },
  ): Promise<{ version: number }>;
  /** Several keys in one transaction (a scheduled change coming into force). */
  setMany(changes: { key: string; value: unknown }[], by: string): Promise<void>;
}

export type RevalidateResult = { ok: true } | { ok: false; error: string };

export interface Revalidator {
  revalidate(tags: string[]): Promise<RevalidateResult>;
}

/** Where a failed request to the site goes to be repeated by the worker. */
export interface RevalidateRetry {
  enqueueRevalidate(tags: string[]): Promise<void>;
}

export interface SettingsServiceDeps {
  store: SettingsStore;
  revalidator: Revalidator;
  outbox?: RevalidateRetry;
  now?: () => Date;
}

// ---- time ---------------------------------------------------------------------------------------------------------

/** The calendar date in Asia/Tashkent (UTC+5, no daylight saving time since 1992). */
export function tashkentDate(at: Date): string {
  return new Date(at.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

const ruDate = (iso: string): string => iso.split("-").reverse().join(".");

// ---- the site cache -------------------------------------------------------------------------------------------------

export interface HttpRevalidatorOptions {
  /** PUBLIC_BASE_URL of the site (internal network address in production). */
  baseUrl: string;
  /** REVALIDATE_HMAC_KEY shared with the site. */
  key: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

/**
 * POST /api/internal/revalidate on the site. The body is `{ "tags": [...] }`; the signature is the hex HMAC-SHA256 of
 * `<timestamp>.<body>` under the shared key, sent with the timestamp (milliseconds) so that the site can refuse old
 * calls (ARCHITECTURE 5.1, 10.1 A08). Never throws: the answer says whether the site took it.
 */
export function createHttpRevalidator(o: HttpRevalidatorOptions): Revalidator {
  const send = o.fetch ?? fetch;
  const now = o.now ?? (() => new Date());
  return {
    async revalidate(tags) {
      const body = JSON.stringify({ tags });
      const timestamp = String(now().getTime());
      const signature = createHmac("sha256", o.key).update(`${timestamp}.${body}`).digest("hex");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 5000);
      try {
        const response = await send(new URL("/api/internal/revalidate", o.baseUrl).toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-nivel-timestamp": timestamp,
            "x-nivel-signature": signature,
          },
          body,
          signal: controller.signal,
        });
        return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ---- results ----------------------------------------------------------------------------------------------------------

export type SaveOutcome =
  | { ok: true; version: number; revalidated: boolean }
  | { ok: false; errors: Record<string, string> };

export type FeeSaveOutcome =
  | { ok: true; version: number; scheduled: boolean; revalidated: boolean }
  | { ok: false; errors: Record<string, string> };

export type Section = "money" | "threshold" | "calendar" | "flags";

/** What stands in the scheduled slot when nothing is scheduled: JSON null cannot be written through the repository. */
export const NOTHING_SCHEDULED = { cleared: true } as const;

const STALE = "Настройки уже изменили в другом окне. Откройте страницу заново.";

function isStale(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return e?.code === "stale_status" || (typeof e?.message === "string" && e.message.startsWith("stale_status"));
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---- the service ----------------------------------------------------------------------------------------------------

export function createSettingsService(deps: SettingsServiceDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const by = (actor: SessionUser) => `admin:${actor.id}`;

  const need = (actor: SessionUser, permission: Permission) => requirePermission(actor, permission);

  async function afterSave(tags: string[]): Promise<boolean> {
    const result = await deps.revalidator.revalidate(tags);
    if (!result.ok) await deps.outbox?.enqueueRevalidate(tags);
    return result.ok;
  }

  async function read(key: string): Promise<SettingRead> {
    return (await store.get(key)) ?? { value: null, version: 0 };
  }

  /** One simple key: validate, write with the version the screen was opened with, tell the site. */
  async function saveSimple(
    key: string,
    schema: {
      safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: never[] } };
    },
    actor: SessionUser,
    raw: unknown,
    opts: { expectedVersion: number; ipHash?: string },
  ): Promise<SaveOutcome> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues) };
    const current = await read(key);
    if (same(current.value, parsed.data)) return { ok: false, errors: { "": "Ничего не изменилось." } };
    try {
      const { version } = await store.set(key, parsed.data, by(actor), {
        expectedVersion: opts.expectedVersion,
        ...(opts.ipHash ? { ipHash: opts.ipHash } : {}),
      });
      return { ok: true, version, revalidated: await afterSave(["settings"]) };
    } catch (error) {
      if (isStale(error)) return { ok: false, errors: { "": STALE } };
      throw error;
    }
  }

  return {
    /** The sections of the settings screen this person may open. */
    sections(actor: SessionUser): Section[] {
      const out: Section[] = [];
      const can = (p: Permission) => {
        try {
          requirePermission(actor, p);
          return true;
        } catch {
          return false;
        }
      };
      if (can("settings.money.read")) out.push("money", "threshold");
      if (can("settings.calendar.read")) out.push("calendar");
      if (can("settings.flags.read")) out.push("flags");
      return out;
    },

    async loadFee(actor: SessionUser) {
      need(actor, "settings.money.read");
      const live = await read(SETTING_KEYS.fee);
      const next = await store.get(SETTING_KEYS.feeNext);
      return { ...live, next: next && FeeSettingsSchema.safeParse(next.value).success ? next : null };
    },

    async loadThreshold(actor: SessionUser) {
      need(actor, "settings.money.read");
      return read(SETTING_KEYS.threshold);
    },

    async loadCalendar(actor: SessionUser) {
      need(actor, "settings.calendar.read");
      return read(SETTING_KEYS.calendar);
    },

    async loadFlags(actor: SessionUser) {
      need(actor, "settings.flags.read");
      const out: Record<string, { value: boolean; version: number }> = {};
      for (const flag of FEATURE_FLAGS) {
        const row = await store.get(flag);
        out[flag] = { value: row?.value === true, version: row?.version ?? 0 };
      }
      return out;
    },

    /**
     * The fee scale (price list). `raw` carries every field but the version: its name is derived from the date of entry
     * into force. A date in the past is refused (a published price list is not changed backwards, GK art. 662); a date
     * that is today or earlier applies at once; a later date waits as a scheduled change and the live scale stays in force.
     */
    async saveFee(
      actor: SessionUser,
      raw: unknown,
      opts: { expectedVersion: number; ipHash?: string },
    ): Promise<FeeSaveOutcome> {
      need(actor, "settings.money.write");
      const live = await read(SETTING_KEYS.fee);
      const current = FeeSettingsSchema.safeParse(live.value);
      const today = tashkentDate(now());
      const input = (raw ?? {}) as Record<string, unknown>;
      const effectiveFrom = typeof input.effectiveFrom === "string" ? input.effectiveFrom : "";
      const version = nextVersionName(current.success ? current.data.version : undefined, effectiveFrom);
      const parsed = FeeSettingsSchema.safeParse({ ...input, version });
      if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues as never) };
      const next = parsed.data;
      if (next.effectiveFrom < today) {
        return { ok: false, errors: { effectiveFrom: "Дата вступления не может быть в прошлом." } };
      }
      if (live.version !== opts.expectedVersion) return { ok: false, errors: { "": STALE } };
      if (current.success) {
        const { version: _a, effectiveFrom: _b, ...a } = current.data;
        const { version: _c, effectiveFrom: _d, ...b } = next;
        if (same(a, b)) return { ok: false, errors: { "": "Ничего не изменилось." } };
      }

      const pending = await store.get(SETTING_KEYS.feeNext);
      const pendingValue = FeeSettingsSchema.safeParse(pending?.value);
      try {
        if (next.effectiveFrom > today) {
          // Waits for its day; the version name takes the pending change into account, not only the live one.
          const result = await store.set(SETTING_KEYS.feeNext, next, by(actor), {
            ...(opts.ipHash ? { ipHash: opts.ipHash } : {}),
          });
          return { ok: true, version: result.version, scheduled: true, revalidated: false };
        }
        if (pendingValue.success) {
          return {
            ok: false,
            errors: {
              "": `Есть запланированное изменение шкалы с ${ruDate(pendingValue.data.effectiveFrom)}: сначала отмените его.`,
            },
          };
        }
        const result = await store.set(SETTING_KEYS.fee, next, by(actor), {
          expectedVersion: opts.expectedVersion,
          ...(opts.ipHash ? { ipHash: opts.ipHash } : {}),
        });
        return {
          ok: true,
          version: result.version,
          scheduled: false,
          revalidated: await afterSave(["settings", "fee"]),
        };
      } catch (error) {
        if (isStale(error)) return { ok: false, errors: { "": STALE } };
        throw error;
      }
    },

    async cancelScheduledFee(actor: SessionUser): Promise<{ ok: true }> {
      need(actor, "settings.money.write");
      const pending = await store.get(SETTING_KEYS.feeNext);
      if (pending && FeeSettingsSchema.safeParse(pending.value).success) {
        await store.set(SETTING_KEYS.feeNext, NOTHING_SCHEDULED, by(actor));
      }
      return { ok: true };
    },

    /** Puts a scheduled scale into force when its day has come. Safe to call often and from several places. */
    async promoteDue(): Promise<number> {
      const pending = await store.get(SETTING_KEYS.feeNext);
      const next = FeeSettingsSchema.safeParse(pending?.value);
      if (!next.success || next.data.effectiveFrom > tashkentDate(now())) return 0;
      await store.setMany(
        [
          { key: SETTING_KEYS.fee, value: next.data },
          { key: SETTING_KEYS.feeNext, value: NOTHING_SCHEDULED },
        ],
        "system:settings",
      );
      await afterSave(["settings", "fee"]);
      return 1;
    },

    async saveThreshold(
      actor: SessionUser,
      raw: unknown,
      opts: { expectedVersion: number; ipHash?: string },
    ): Promise<SaveOutcome> {
      need(actor, "settings.money.write");
      return saveSimple(SETTING_KEYS.threshold, ThresholdSettingsSchema as never, actor, raw, opts);
    },

    async saveCalendar(
      actor: SessionUser,
      raw: unknown,
      opts: { expectedVersion: number; ipHash?: string },
    ): Promise<SaveOutcome> {
      need(actor, "settings.calendar.write");
      return saveSimple(SETTING_KEYS.calendar, CalendarSettingsSchema as never, actor, raw, opts);
    },

    /** Switches flags: only those named and only when they change; each is its own key. */
    async saveFlags(
      actor: SessionUser,
      flags: Partial<Record<(typeof FEATURE_FLAGS)[number], unknown>>,
    ): Promise<{ ok: true; changed: string[]; revalidated: boolean } | { ok: false; errors: Record<string, string> }> {
      need(actor, "settings.flags.write");
      const errors: Record<string, string> = {};
      const wanted: [string, boolean][] = [];
      for (const flag of FEATURE_FLAGS) {
        if (!(flag in flags)) continue;
        const value = flags[flag];
        if (typeof value !== "boolean") errors[flag] = "Нужно «да» или «нет».";
        else wanted.push([flag, value]);
      }
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      const changed: string[] = [];
      for (const [flag, value] of wanted) {
        const current = await store.get(flag);
        if ((current?.value === true) === value && current !== null) continue;
        if (current === null && value === false) continue;
        await store.set(flag, value, by(actor));
        changed.push(flag);
      }
      const revalidated = changed.length > 0 ? await afterSave(["settings"]) : true;
      return { ok: true, changed, revalidated };
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
