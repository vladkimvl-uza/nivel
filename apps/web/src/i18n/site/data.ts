// What the page reads from the database, without the database: the readers take a function that fetches the row, so the
// rules (a broken or missing setting falls back to the defaults, a draft is a draft) are tested alone. The wiring to the
// database of the role `web` is in apps/web/app/[locale]/(marketing)/_data/server.ts.
import { DEFAULT_FEE_SCALE, type FeeScale, parseFeeScale } from "./fee-scale.ts";
import { type LegalRow, pickLegalDocument } from "./legal.ts";

export interface FeeScaleResult {
  scale: FeeScale;
  /** `db` when the owner's setting was read, `default` for the rules of 05.10.2026. */
  source: "db" | "default";
}

/** The fee scale of the price list: the setting `money.fee_settings`, else the accepted defaults. Never throws. */
export async function readFeeScale(
  read: () => Promise<{ value: unknown } | null>,
  log: (message: string) => void = (m) => console.error(m),
): Promise<FeeScaleResult> {
  try {
    const row = await read();
    if (row === null) return { scale: { ...DEFAULT_FEE_SCALE }, source: "default" };
    const scale = parseFeeScale(row.value);
    if (scale) return { scale, source: "db" };
    log("site: money.fee_settings is not what the price list needs; the defaults are shown");
  } catch {
    // The error text may name hosts, roles or ports: it stays out of the log of the site.
    log("site: the fee settings could not be read; the defaults are shown");
  }
  return { scale: { ...DEFAULT_FEE_SCALE }, source: "default" };
}

/** The flag of the request form: until the owner switches it on, the page shows the bot instead (CLAUDE.md, feature flags). */
export const LEAD_FORM_FLAG = "feature.webLeadForm";

/** A feature flag of `ops.settings`: on only for the value `true`; a missing setting, another value or a dead database is off. */
export async function readFeatureFlag(
  read: () => Promise<{ value: unknown } | null>,
  log: (message: string) => void = (m) => console.error(m),
): Promise<boolean> {
  try {
    const row = await read();
    return row !== null && row.value === true;
  } catch {
    log("site: a feature flag could not be read; it counts as switched off");
    return false;
  }
}

export type LegalResolution =
  | {
      source: "db";
      draft: boolean;
      version: string;
      effectiveFrom: string | null;
      sha256: string;
      bodyMd: string;
      /** content.legal_documents.id */
      id: string;
    }
  /** No document in the database in this language: the page shows the text built into the site (a draft). */
  | { source: "builtin"; draft: true };

export function resolveLegal(
  rows: readonly LegalRow[],
  kind: string,
  lang: "uz" | "ru",
  today: string,
): LegalResolution {
  const row = pickLegalDocument(rows, kind, lang, today);
  if (!row) return { source: "builtin", draft: true };
  return {
    source: "db",
    draft: row.status !== "published",
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    sha256: row.textSha256,
    bodyMd: row.bodyMd,
    id: row.id,
  };
}

const TASHKENT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `yyyy-mm-dd` of the moment in Asia/Tashkent. */
export function todayInTashkent(at: Date = new Date()): string {
  return TASHKENT.format(at);
}
