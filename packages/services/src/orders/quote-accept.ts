// The quote becomes `accepted` together with the order. Only the admin role may update sales.quotes (DATA-MAP 2): when
// the customer accepts through the bot or the site the order is accepted and the quote stays `sent`; the status of the
// order is the truth (request to the integrator: let sales.apply_transition mark the quote on ACCEPT).
import { type Executor, sales } from "@nivel/db/repos";
import { can, type Runtime } from "./runtime.ts";

export async function markQuoteAccepted(
  rt: Runtime,
  tx: Executor,
  quoteId: string,
  at: Date,
  acceptance: Record<string, unknown>,
): Promise<boolean> {
  if (!can(rt, "quotes.write")) return false;
  await sales.markQuoteAccepted(tx, quoteId, acceptance, at);
  return true;
}
