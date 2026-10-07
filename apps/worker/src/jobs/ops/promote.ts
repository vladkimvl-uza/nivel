// The scale of the fee that waits for its day (ARCHITECTURE 6.3, the admin panel's settings): the owner may schedule a new scale
// for a later date; it waits in `money.fee_settings.next` and comes into force on its day. Until now only opening the money page
// of the admin panel did that (settings.promoteDue); the worker does it every day at 00:05 Tashkent, in the same way: the scale is
// copied to `money.fee_settings`, the slot is cleared with the mark { cleared: true } and the site is told to drop its cache.
//
// The role nivel_worker has SELECT on ops.settings and nothing else (DATA-MAP 2), so this job writes only when the database
// gives the role the right; without it the job says so in the log and the scale waits for the page of the admin panel as before.
// TODO(integrator): either GRANT UPDATE, INSERT on ops.settings to nivel_worker (wide: the worker could then change the prices),
// or, better, a SECURITY DEFINER function ops.promote_fee_scale(now) for this one pair of keys; see the report of WP-14.
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import { DEFAULT_FEE_SETTINGS } from "@nivel/domain/fee";
import type { Logger } from "pino";

export const FEE_KEY = "money.fee_settings";
export const FEE_NEXT_KEY = "money.fee_settings.next";
/** What stands in the slot when nothing is scheduled (the admin panel writes it: JSON null cannot be written through the repository). */
export const NOTHING_SCHEDULED = { cleared: true } as const;
const SYSTEM_ACTOR = "system:settings";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sameShape(value: unknown, model: unknown): boolean {
  if (typeof model === "number") return typeof value === "number" && Number.isSafeInteger(value);
  if (typeof model === "string") return typeof value === "string" && value.trim() !== "";
  if (Array.isArray(model)) return Array.isArray(value) && value.every((v) => typeof v === "string");
  if (model !== null && typeof model === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const have = Object.keys(value as Record<string, unknown>).sort();
    const want = Object.keys(model as Record<string, unknown>).sort();
    if (have.length !== want.length || have.some((k, i) => k !== want[i])) return false;
    return want.every((k) => sameShape((value as Record<string, unknown>)[k], (model as Record<string, unknown>)[k]));
  }
  return false;
}

function isRealDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** True for an object with exactly the keys of `FeeSettings` of the domain and values of the same kinds (whole numbers where they are). */
export function isFeeScaleShape(value: unknown): value is Record<string, unknown> & { effectiveFrom: string } {
  if (!sameShape(value, DEFAULT_FEE_SETTINGS)) return false;
  return isRealDate((value as { effectiveFrom: string }).effectiveFrom);
}

export type PromoteOutcome =
  | { outcome: "none" }
  | { outcome: "invalid" }
  | { outcome: "not_due"; effectiveFrom: string }
  | { outcome: "no_right"; effectiveFrom: string }
  | { outcome: "promoted"; effectiveFrom: string };

export interface PromoteDeps {
  now(): Date;
  log: Logger;
  /** The value of `money.fee_settings.next`, or null. */
  readNext(): Promise<unknown>;
  /** True when the database role may write ops.settings. */
  canWrite(): Promise<boolean>;
  /** Copies the scale into `money.fee_settings` and clears the slot, in one transaction. */
  promote(next: Record<string, unknown>): Promise<void>;
  enqueue(input: ops.OutboxInput): Promise<unknown>;
}

export async function promoteDueFeeScale(deps: PromoteDeps): Promise<PromoteOutcome> {
  const next = await deps.readNext();
  if (next === null || next === undefined) return { outcome: "none" };
  if (typeof next === "object" && (next as { cleared?: unknown }).cleared === true) return { outcome: "none" };
  const today = isoDateInTashkent(deps.now());
  if (!isFeeScaleShape(next)) {
    deps.log.error("fee scale: the scheduled scale of ops.settings is damaged, it is not put into force");
    await deps.enqueue({
      kind: "telegram_message",
      dedupeKey: `ops:alert:fee_scale:${today}`,
      priority: 8,
      payload: {
        target: "group",
        templateKey: "ops.alert",
        lang: "ru",
        params: { check: "fee_scale", detail: "запланированная шкала платы повреждена, она не введена в действие" },
      },
    });
    return { outcome: "invalid" };
  }
  if (next.effectiveFrom > today) return { outcome: "not_due", effectiveFrom: next.effectiveFrom };
  if (!(await deps.canWrite())) {
    deps.log.warn(
      { effectiveFrom: next.effectiveFrom },
      "fee scale: the role of the worker has no right to write ops.settings, the scale waits for the admin panel",
    );
    return { outcome: "no_right", effectiveFrom: next.effectiveFrom };
  }
  await deps.promote(next);
  await deps.enqueue({
    kind: "job",
    dedupeKey: `web.revalidate:fee-promoted:${next.effectiveFrom}`,
    payload: { job: "web.revalidate", tags: ["settings", "fee"] },
  });
  deps.log.info({ effectiveFrom: next.effectiveFrom }, "fee scale: the scheduled scale is in force");
  return { outcome: "promoted", effectiveFrom: next.effectiveFrom };
}

export function createPgPromotePorts(db: Db): Pick<PromoteDeps, "readNext" | "canWrite" | "promote"> {
  return {
    readNext: async () => (await ops.getSetting(db, FEE_NEXT_KEY))?.value ?? null,
    async canWrite() {
      const { rows } = await db.$client.query<{ ok: boolean }>(
        `select has_table_privilege(current_user, 'ops.settings', 'UPDATE')
            and has_table_privilege(current_user, 'ops.settings', 'INSERT') as ok`,
      );
      return rows[0]?.ok === true;
    },
    async promote(next) {
      await db.transaction(async (tx) => {
        await ops.setSetting(tx, FEE_KEY, next, SYSTEM_ACTOR);
        await ops.setSetting(tx, FEE_NEXT_KEY, NOTHING_SCHEDULED, SYSTEM_ACTOR);
      });
    },
  };
}
