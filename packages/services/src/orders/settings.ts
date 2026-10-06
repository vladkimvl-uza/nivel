// Settings of the owner (ops.settings, ARCHITECTURE 3.3) read as the domain wants them. A value the owner has not set
// falls back to the default of the domain (DECISIONS R-8); a value that is set but broken is a ConfigError, never a guess.

import type { Executor } from "@nivel/db/repos";
import { ops } from "@nivel/db/repos";
import { createWorkCalendar, type WorkCalendar } from "@nivel/domain/calendar";
import { DEFAULT_FEE_SETTINGS, type FeeSettings, type FeeStage } from "@nivel/domain/fee";
import { type Bp, bp, type Sum, sum } from "@nivel/domain/money";
import { DEFAULT_THRESHOLD_SETTINGS, type ThresholdSettings } from "@nivel/domain/threshold";
import { ConfigError } from "./errors.ts";

type Raw = Record<string, unknown>;

function record(value: unknown, path: string): Raw {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`setting ${path} must be an object`);
  }
  return value as Raw;
}

function whole(raw: Raw, key: string, path: string, min = 0): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min) {
    throw new ConfigError(`setting ${path}.${key} must be a whole number of at least ${min}`);
  }
  return v;
}

const sumOf = (raw: Raw, key: string, path: string): Sum => sum(whole(raw, key, path));

function bpOf(raw: Raw, key: string, path: string): Bp {
  const v = whole(raw, key, path);
  if (v > 10_000) throw new ConfigError(`setting ${path}.${key} must not exceed 10000 basis points`);
  return bp(v);
}

function text(raw: Raw, key: string, path: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") throw new ConfigError(`setting ${path}.${key} must be a text`);
  return v;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(raw: Raw, key: string, path: string): string {
  const v = text(raw, key, path);
  if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new ConfigError(`setting ${path}.${key} must be a date like 2026-10-05`);
  }
  return v;
}

const STAGES: readonly FeeStage[] = ["selection", "purchase", "assembly", "handover"];

export const FEE_SETTINGS_KEY = "money.fee_settings";
export const THRESHOLD_SETTINGS_KEY = "money.threshold";
export const CALENDAR_SETTINGS_KEY = "calendar.work";
/** `false` once the tax authority has answered in writing (DECISIONS R-7); until then the reserve runs. */
export const TAX_RISK_SETTING_KEY = "money.tax_risk_active";

export function parseFeeSettings(value: unknown): FeeSettings {
  const path = FEE_SETTINGS_KEY;
  const raw = record(value, path);
  const shares = record(raw.stageSharesBp, `${path}.stageSharesBp`);
  const stageSharesBp = {
    selection: bpOf(shares, "selection", `${path}.stageSharesBp`),
    purchase: bpOf(shares, "purchase", `${path}.stageSharesBp`),
    assembly: bpOf(shares, "assembly", `${path}.stageSharesBp`),
    handover: bpOf(shares, "handover", `${path}.stageSharesBp`),
  };
  if (stageSharesBp.selection + stageSharesBp.purchase + stageSharesBp.assembly + stageSharesBp.handover !== 10_000) {
    throw new ConfigError(`setting ${path}.stageSharesBp must add up to 10000 basis points`);
  }
  const stages = raw.commissionLineStages;
  if (!Array.isArray(stages) || stages.some((s) => !STAGES.includes(s as FeeStage))) {
    throw new ConfigError(`setting ${path}.commissionLineStages must list stage names: ${STAGES.join(", ")}`);
  }
  const shelf = record(raw.shelfLifeHours, `${path}.shelfLifeHours`);
  return {
    version: text(raw, "version", path),
    effectiveFrom: isoDate(raw, "effectiveFrom", path),
    pcLowRateBp: bpOf(raw, "pcLowRateBp", path),
    pcHighRateBp: bpOf(raw, "pcHighRateBp", path),
    pcThreshold: sumOf(raw, "pcThreshold", path),
    pcHighMinFee: sumOf(raw, "pcHighMinFee", path),
    mountRateBp: bpOf(raw, "mountRateBp", path),
    complexRateBp: bpOf(raw, "complexRateBp", path),
    minFullCyclePc: sumOf(raw, "minFullCyclePc", path),
    minFreeWindowPc: sumOf(raw, "minFreeWindowPc", path),
    minFullCycleSetup: sumOf(raw, "minFullCycleSetup", path),
    stageSharesBp,
    commissionLineStages: stages as FeeStage[],
    advanceBp: bpOf(raw, "advanceBp", path),
    reserveBp: bpOf(raw, "reserveBp", path),
    reserveHighBp: bpOf(raw, "reserveHighBp", path),
    reserveHighShareBp: bpOf(raw, "reserveHighShareBp", path),
    reserveRoundStep: whole(raw, "reserveRoundStep", path, 1),
    podborShareBp: bpOf(raw, "podborShareBp", path),
    podborCreditDays: whole(raw, "podborCreditDays", path),
    afterTestsRetainBp: bpOf(raw, "afterTestsRetainBp", path),
    shelfLifeHours: {
      components: whole(shelf, "components", `${path}.shelfLifeHours`, 1),
      furniture: whole(shelf, "furniture", `${path}.shelfLifeHours`, 1),
    },
  };
}

export function parseCalendarSettings(value: unknown): WorkCalendar {
  const path = CALENDAR_SETTINGS_KEY;
  const raw = record(value, path);
  const holidays = raw.holidays;
  if (!Array.isArray(holidays) || holidays.some((h) => typeof h !== "string" || !ISO_DATE.test(h))) {
    throw new ConfigError(`setting ${path}.holidays must be a list of dates like 2026-10-13`);
  }
  try {
    return createWorkCalendar(holidays as string[], { from: text(raw, "from", path), to: text(raw, "to", path) });
  } catch (e) {
    if (e instanceof RangeError) throw new ConfigError(`setting ${path}: ${e.message}`);
    throw e;
  }
}

export function parseThresholdSettings(value: unknown): ThresholdSettings {
  const path = THRESHOLD_SETTINGS_KEY;
  const raw = record(value, path);
  const alerts = raw.alertsBp;
  if (!Array.isArray(alerts)) throw new ConfigError(`setting ${path}.alertsBp must be a list`);
  const proportion = raw.proportion;
  if (proportion !== "without_registration_day" && proportion !== "with_registration_day") {
    throw new ConfigError(`setting ${path}.proportion must be without_registration_day or with_registration_day`);
  }
  const settings: ThresholdSettings = {
    annualLimit: sumOf(raw, "annualLimit", path),
    alertsBp: alerts.map((a) => {
      if (typeof a !== "number") throw new ConfigError(`setting ${path}.alertsBp must hold numbers`);
      return bp(a);
    }),
    proportion,
  };
  if (raw.planCap !== undefined && raw.planCap !== null) settings.planCap = sumOf(raw, "planCap", path);
  if (raw.registrationDate !== undefined && raw.registrationDate !== null) {
    settings.registrationDate = isoDate(raw, "registrationDate", path);
  }
  return settings;
}

export async function loadFeeSettings(ex: Executor): Promise<FeeSettings> {
  const row = await ops.getSetting(ex, FEE_SETTINGS_KEY);
  return row ? parseFeeSettings(row.value) : { ...DEFAULT_FEE_SETTINGS };
}

/** Without a calendar of the owner every day from Monday to Saturday works (DATA-MAP 10: holidays are empty until set). */
export async function loadCalendar(ex: Executor): Promise<WorkCalendar> {
  const row = await ops.getSetting(ex, CALENDAR_SETTINGS_KEY);
  return parseCalendarSettings(row?.value ?? { holidays: [], from: "10:00", to: "19:00" });
}

export async function loadThresholdSettings(ex: Executor): Promise<ThresholdSettings> {
  const row = await ops.getSetting(ex, THRESHOLD_SETTINGS_KEY);
  return row ? parseThresholdSettings(row.value) : { ...DEFAULT_THRESHOLD_SETTINGS };
}

export async function loadTaxRiskActive(ex: Executor): Promise<boolean> {
  const row = await ops.getSetting(ex, TAX_RISK_SETTING_KEY);
  if (row === null) return true;
  if (typeof row.value !== "boolean") throw new ConfigError(`setting ${TAX_RISK_SETTING_KEY} must be true or false`);
  return row.value;
}
