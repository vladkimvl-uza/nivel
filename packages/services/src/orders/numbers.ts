// Public numbers L-2026-0001 (a lead), NV-2026-0001 (an order), G-2026-0001 (a warranty case): always from
// ops.next_number, never from a counter of ours. The database numbers one after another inside the transaction (a failed
// request burns no number) and by the year of the business calendar of Tashkent; it gives lead numbers to the site and
// the bot, and the other kinds to the admin only.
import { DbRuleError, type Executor, guarded, ops, sales } from "@nivel/db/repos";
import { ForbiddenError } from "./errors.ts";
import { type Runtime, runtimeOf } from "./runtime.ts";

export type NumberKind = "L" | "NV" | "G";

export async function takeNumber(kind: NumberKind, rt?: Runtime, ex?: Executor): Promise<string> {
  const r = runtimeOf(rt);
  try {
    return await guarded(() => ops.nextNumber(ex ?? r.db, kind, sales.tashkentYear(r.now())));
  } catch (e) {
    if (e instanceof DbRuleError && (e.code === "number_not_allowed" || e.code === "permission_denied")) {
      throw new ForbiddenError(`the ${r.role} role of the database cannot take a number of the kind ${kind}`);
    }
    throw e;
  }
}
