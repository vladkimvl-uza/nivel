// Who is writing: the customer of the Telegram id (the database knows him once he has agreed), the language of the
// dialog and whether the consent for the processing of personal data stands. Asked of the database, not trusted from
// the session: a session that was cleaned must not make a customer who agreed agree again, nor the other way round.
import { langOf } from "@nivel/telegram";
import type { BotContext } from "../context.ts";
import { type CustomerView, findCustomer, hasProcessingConsent } from "../store.ts";

export interface Profile {
  customer: CustomerView | null;
  consented: boolean;
}

/** Fills `ctx.lang` and the consent flag of the session from the database; the answer is kept for the update. */
export async function loadProfile(ctx: BotContext): Promise<Profile> {
  const from = ctx.from;
  const customer = from === undefined ? null : await findCustomer(ctx.deps.db, from.id);
  if (ctx.session.lang === undefined && customer !== null) ctx.session.lang = langOf(customer.lang);
  let consented = ctx.session.consented;
  if (!consented && customer !== null) {
    consented = await hasProcessingConsent(ctx.deps.db, customer.id);
    ctx.session.consented = consented;
  }
  return { customer, consented };
}
