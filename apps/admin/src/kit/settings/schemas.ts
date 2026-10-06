// Schemas of the settings the admin edits in ops.settings (ARCHITECTURE 3.3, 4.6, 4.8; ADR-004: whole sums, basis
// points, no floats). The shapes are those of the frozen domain contracts (`FeeSettings`, `ThresholdSettings`,
// `ResponseHours`); a compile-time check below fails when the contract gets a key these schemas do not know.
import type { FeeSettings } from "@nivel/domain/fee";
import type { ThresholdSettings } from "@nivel/domain/threshold";
import { z } from "zod";

export const SETTING_KEYS = {
  fee: "money.fee_settings",
  /** A change that takes effect on a later date waits here until its day comes. */
  feeNext: "money.fee_settings.next",
  threshold: "money.threshold",
  calendar: "calendar.work",
} as const;

export const FEATURE_FLAGS = ["feature.ai", "feature.setupConfigurator", "feature.scene", "feature.miniApp"] as const;

/** `YYYY-MM-DD` that is a real calendar day. */
export const IsoDateSchema = z.string().refine(isRealDate, { error: "Нужна дата в виде ГГГГ-ММ-ДД." });

export function isRealDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** A whole sum in sums (so'm): an integer from 0, never a fraction. */
const sum = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Basis points: 10 000 = 100 %. */
const bp = z.number().int().min(0).max(10_000);

export const FeeSettingsSchema = z.strictObject({
  version: z.string().trim().min(1).max(40),
  effectiveFrom: IsoDateSchema,
  pcLowRateBp: bp,
  pcHighRateBp: bp,
  pcThreshold: sum,
  pcHighMinFee: sum,
  mountRateBp: bp,
  complexRateBp: bp,
  minFullCyclePc: sum,
  minFreeWindowPc: sum,
  minFullCycleSetup: sum,
  stageSharesBp: z
    .strictObject({ selection: bp, purchase: bp, assembly: bp, handover: bp })
    .refine((s) => s.selection + s.purchase + s.assembly + s.handover === 10_000, {
      error: "Доли этапов должны давать ровно 10 000 б. п. (100 %).",
    }),
  commissionLineStages: z.array(z.enum(["selection", "purchase", "assembly", "handover"])),
  advanceBp: bp,
  reserveBp: bp,
  reserveHighBp: bp,
  reserveHighShareBp: bp,
  reserveRoundStep: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  podborShareBp: bp,
  podborCreditDays: z.number().int().min(1).max(365),
  afterTestsRetainBp: bp,
  shelfLifeHours: z.strictObject({
    components: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    furniture: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
  }),
});
export type FeeSettingsInput = z.infer<typeof FeeSettingsSchema>;

export const ThresholdSettingsSchema = z.strictObject({
  annualLimit: sum,
  registrationDate: IsoDateSchema.optional(),
  planCap: sum.optional(),
  alertsBp: z.array(bp).refine((a) => a.every((v, i) => i === 0 || v > (a[i - 1] ?? 0)), {
    error: "Пороги оповещений должны идти по возрастанию.",
  }),
  proportion: z.enum(["without_registration_day", "with_registration_day"]),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Время в виде ЧЧ:ММ." });

export const CalendarSettingsSchema = z
  .strictObject({
    tz: z.literal("Asia/Tashkent"),
    /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
    workdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .refine((d) => new Set(d).size === d.length, { error: "День недели указан дважды." }),
    from: hhmm,
    to: hhmm,
    holidays: z
      .array(IsoDateSchema)
      .refine((d) => new Set(d).size === d.length, { error: "В списке праздников есть повтор." }),
  })
  .refine((c) => c.from < c.to, { error: "Начало часов ответа должно быть раньше конца.", path: ["to"] });

// Drift guard: a key added to a frozen contract must be added to the schema too (this fails to compile otherwise).
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;
export const KEYS_MATCH_CONTRACTS: [
  SameKeys<FeeSettings, FeeSettingsInput>,
  SameKeys<ThresholdSettings, z.infer<typeof ThresholdSettingsSchema>>,
] = [true, true];

// ---- helpers ----------------------------------------------------------------------------------------------------

/**
 * The name of a new version: the date it takes effect; when that name is taken (a second change for the same day) a
 * counter is added, so that no two versions share a name.
 */
export function nextVersionName(current: string | undefined, effectiveFrom: string): string {
  if (!current) return effectiveFrom;
  const m = new RegExp(`^${effectiveFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.(\\d+))?$`).exec(current);
  if (!m) return effectiveFrom;
  return `${effectiveFrom}.${Number(m[1] ?? "1") + 1}`;
}

/** Holidays typed by a person: one per line (or separated by ; or ,), as ГГГГ-ММ-ДД or ДД.ММ.ГГГГ; sorted, no repeats. */
export function parseHolidays(text: string): { ok: true; dates: string[] } | { ok: false; error: string } {
  const out = new Set<string>();
  for (const raw of text.split(/[\n\r;,]+/)) {
    const item = raw.trim();
    if (item === "") continue;
    const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(item);
    const iso = ru ? `${ru[3]}-${ru[2]}-${ru[1]}` : item;
    if (!isRealDate(iso)) return { ok: false, error: `Не дата: ${item}.` };
    out.add(iso);
  }
  return { ok: true, dates: [...out].sort() };
}
