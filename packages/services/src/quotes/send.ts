// quotes.send (BUILD_PLAN WP-07): the owner has checked the estimate by hand and sends it. In one transaction the quote
// becomes `sent` (with the mark of the check and the term counted from this moment) and the order goes to
// `estimate_sent`; if the automaton refuses, the quote stays a draft.
import { DbRuleError, sales } from "@nivel/db/repos";
import { type ActorRef, checkActor } from "../orders/actor.ts";
import { type DispatchResult, dispatchInTx, inDispatchTransaction } from "../orders/dispatch.ts";
import { ValidationError } from "../orders/errors.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { loadOffers } from "../orders/snapshot.ts";
import { assertUuid, isUuid } from "../orders/validate.ts";
import { readStoredTotals } from "./stored.ts";

const HOUR_MS = 3_600_000;

export async function send(
  input: { orderId: string; quoteId: string },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<DispatchResult> {
  const r = runtimeOf(rt);
  requireCapability(r, "quotes.write");
  const orderId = assertUuid(input.orderId, "orderId");
  const quoteId = assertUuid(input.quoteId, "quoteId");
  const actor = checkActor(actorRef);
  return inDispatchTransaction(r, (tx) =>
    dispatchInTx(r, tx, orderId, { type: "SEND_ESTIMATE", quoteId, manuallyChecked: true }, actor, {
      before: async (ex, order) => {
        // Only the current quote of this order can be sent; anything else the automaton refuses as it is.
        if (order.currentQuoteId !== quoteId) return;
        const quote = await sales.getQuote(ex, quoteId);
        if (!quote) return;
        if (quote.status !== "draft") {
          throw ValidationError.of(
            "quoteId",
            "quote_not_draft",
            `the quote is ${quote.status}: only a draft can be sent`,
          );
        }
        if (!isUuid(actor.id)) {
          throw ValidationError.of(
            "actor.id",
            "admin_user_required",
            "the estimate is checked by an account of the admin panel",
          );
        }
        const now = r.now();
        const stored = readStoredTotals(quote.totals);
        const offers = await loadOffers(ex, { uz: order.offerVersionUzId, ru: order.offerVersionRuId });
        try {
          await sales.markQuoteSent(ex, quoteId, {
            checkedBy: actor.id,
            at: now,
            // The term counts from the moment of sending, not from the moment the draft was calculated.
            validUntil: new Date(now.getTime() + stored.shelfLifeHours * HOUR_MS),
            // Without published offers the estimate goes out, with the watermark "not an offer" (R-25).
            watermarkDraft: !(offers.status.uz === "published" && offers.status.ru === "published"),
          });
        } catch (e) {
          if (e instanceof DbRuleError && e.code === "foreign_key_violation") {
            throw ValidationError.of(
              "actor.id",
              "admin_user_unknown",
              "the account that checks the estimate does not exist",
            );
          }
          throw e;
        }
      },
    }),
  );
}
