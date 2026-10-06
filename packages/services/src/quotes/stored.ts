// How a quote is stored (sales.quotes): the money as columns the database checks (fee = advance + final, parts of the
// fee add up, limit >= reserve) and the whole result of the domain as JSON with the compatibility verdict and the shelf
// life, which the order snapshot reads back. One writer, one reader, here.
import type { CompatResult } from "@nivel/domain/compat";
import type { Eligibility, QuoteTotals } from "@nivel/domain/fee";
import { ConfigError } from "../orders/errors.ts";

export type CompatVerdict = CompatResult["verdict"];
const VERDICTS: readonly string[] = ["ok", "warn", "block", "incomplete"];
const ELIGIBILITY_MODES: readonly string[] = ["full_cycle", "free_window_only", "podbor_only", "setup_below_min"];

export interface StoredExtras {
  compatVerdict: CompatVerdict;
  /** 24 hours, 72 for furniture only: the term of validity counted from the moment the estimate is sent. */
  shelfLifeHours: number;
  quoteKind: "pc" | "setup";
}

export interface StoredTotals extends StoredExtras {
  totals: QuoteTotals;
  eligibility: Eligibility;
}

export function serializeTotals(totals: QuoteTotals, extras: StoredExtras): Record<string, unknown> {
  return { schema: 1, totals: JSON.parse(JSON.stringify(totals)), ...extras };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function readStoredTotals(json: unknown): StoredTotals {
  if (!isRecord(json) || !isRecord(json.totals)) throw new ConfigError("a stored quote has no totals");
  const totals = json.totals;
  if (!isRecord(totals.eligibility) || !ELIGIBILITY_MODES.includes(String(totals.eligibility.mode))) {
    throw new ConfigError("a stored quote has no valid eligibility");
  }
  if (typeof json.compatVerdict !== "string" || !VERDICTS.includes(json.compatVerdict)) {
    throw new ConfigError("a stored quote has no valid compatibility verdict");
  }
  if (!Number.isSafeInteger(json.shelfLifeHours) || (json.shelfLifeHours as number) < 1) {
    throw new ConfigError("a stored quote has no valid shelf life");
  }
  if (!isRecord(totals.fee) || typeof totals.fee.total !== "number") throw new ConfigError("a stored quote has no fee");
  const parsed = { ...totals } as unknown as QuoteTotals;
  if (typeof totals.validUntil === "string") parsed.validUntil = new Date(totals.validUntil);
  return {
    totals: parsed,
    eligibility: totals.eligibility as unknown as Eligibility,
    compatVerdict: json.compatVerdict as CompatVerdict,
    shelfLifeHours: json.shelfLifeHours as number,
    quoteKind: json.quoteKind === "setup" ? "setup" : "pc",
  };
}

/** The money columns of sales.quotes from the totals of the domain. */
export function quoteColumns(totals: QuoteTotals) {
  return {
    componentsSum: totals.componentsSum,
    reserveBp: totals.reserveBp,
    reserveSum: totals.reserveSum,
    purchaseLimit: totals.purchaseLimit,
    feeTotal: totals.fee.total,
    feeCommissionLine: totals.fee.commissionLine,
    feeWorksLine: totals.fee.worksLine,
    feeAdvance: totals.advance,
    feeFinal: totals.final,
    outsideScaleSum: totals.outsideScaleSum,
    validUntil: totals.validUntil ?? null,
  };
}
