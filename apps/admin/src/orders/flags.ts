// Switches of unfinished work (CLAUDE.md: unfinished work is merged switched off). `feature.pdf` is off until the PDF
// documents of WP-12 exist: the screens work without their buttons.
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";

export const PDF_FLAG = "feature.pdf";

/** A flag is on only when its setting is exactly `true`: a missing or odd value is off. */
export async function featureOn(db: Db, key: string): Promise<boolean> {
  return (await ops.getSetting(db, key))?.value === true;
}
