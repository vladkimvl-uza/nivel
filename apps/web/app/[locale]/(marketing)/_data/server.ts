// The wiring of the pages to the database of the role `web` and to the cache of the site (tags `fee`, `settings`, `legal`,
// `content`: /api/internal/revalidate drops them when the admin panel or the worker say so). The rules are in
// apps/web/src/i18n/site/data.ts and are tested there; this file only connects them.
import { createHash } from "node:crypto";
import { createDb, type Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { unstable_cache } from "next/cache";
import { type FeeScaleResult, LEAD_FORM_FLAG, readFeatureFlag, readFeeScale } from "../../../../src/i18n/site/data.ts";
import type { LegalKind, LegalRow } from "../../../../src/i18n/site/legal.ts";

const FEE_SETTINGS_KEY = "money.fee_settings";

const shared = globalThis as { __nivelWebDb?: Db };

// The cache of the site lives in files next to the build and does not know which database an entry came from: a build that ran
// against another database, or a second site started from the same folder (the e2e does), would hand out its entries. The key of
// every entry therefore carries a short fingerprint of the database address (a hash: the address holds the password).
const SOURCE = createHash("sha256")
  .update(process.env.DATABASE_URL_WEB ?? "")
  .digest("hex")
  .slice(0, 8);

/** One small pool per process, kept across the reloads of development. */
function db(): Db {
  const url = process.env.DATABASE_URL_WEB;
  if (!url) throw new Error("DATABASE_URL_WEB is not set");
  shared.__nivelWebDb ??= createDb(url, { max: 3, applicationName: "nivel-web" });
  return shared.__nivelWebDb;
}

/** The fee scale of the price list; the defaults of 05.10.2026 when the setting is missing or the database does not answer. */
export const getFeeScale: () => Promise<FeeScaleResult> = unstable_cache(
  () =>
    readFeeScale(async () => {
      const row = await ops.getSetting(db(), FEE_SETTINGS_KEY);
      return row ? { value: row.value } : null;
    }),
  ["site:fee-scale", SOURCE],
  { tags: ["fee", "settings"], revalidate: 300 },
);

/** Whether the request form is shown: the flag `feature.webLeadForm`, off until the services are connected and the owner says so. */
export const getLeadFormEnabled: () => Promise<boolean> = unstable_cache(
  () => readFeatureFlag(() => ops.getSetting(db(), LEAD_FORM_FLAG)),
  ["site:lead-form-flag", SOURCE],
  { tags: ["settings"], revalidate: 60 },
);

const legalRowsOf = unstable_cache(
  async (kind: LegalKind): Promise<LegalRow[]> => {
    const rows = await db().query.legalDocuments.findMany({
      columns: {
        id: true,
        kind: true,
        version: true,
        lang: true,
        bodyMd: true,
        status: true,
        textSha256: true,
        effectiveFrom: true,
        createdAt: true,
      },
      where: (t, { eq }) => eq(t.kind, kind),
    });
    return rows;
  },
  ["site:legal", SOURCE],
  { tags: ["legal", "content"], revalidate: 600 },
);

/** The versions of one kind of document in the database; none when the database does not answer (the page then shows its own draft). */
export async function getLegalRows(kind: LegalKind): Promise<LegalRow[]> {
  try {
    return await legalRowsOf(kind);
  } catch {
    console.error("site: the legal documents could not be read; the built-in drafts are shown");
    return [];
  }
}
