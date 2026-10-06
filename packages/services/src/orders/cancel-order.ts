// orders.cancel (ARCHITECTURE 4.7, 4.9): the owner cancels an order at the request of the customer. The point of the
// cancellation follows from the status, the settlement is calculated by the server (see dispatch), and the owner enters
// only what the server cannot know: the share of the assembly that is done and the losses with documents.
import { sales } from "@nivel/db/repos";
import type { CancelPoint, CancelSettlement } from "@nivel/domain/cancel";
import { sum } from "@nivel/domain/money";
import type { ActorRef } from "./actor.ts";
import { POINT_BY_STATUS } from "./cancel.ts";
import { type CancelEventInput, type DispatchResult, dispatch } from "./dispatch.ts";
import { ForbiddenError, NotFoundError } from "./errors.ts";
import { type Runtime, runtimeOf } from "./runtime.ts";
import { assertText, assertUuid, assertWholeSum } from "./validate.ts";

export interface CancelOrderInput {
  orderId: string;
  reason: string;
  /** Share of the assembly done, in basis points (0-10000), for a cancellation during the assembly. */
  assemblyDoneBp?: number;
  /** Losses of the sole proprietor with documents, whole sums: they reduce the refund of the money. */
  documentedLosses?: number;
}

export async function cancel(input: CancelOrderInput, actor: ActorRef, rt?: Runtime): Promise<DispatchResult> {
  const r = runtimeOf(rt);
  if (r.role === "web") throw new ForbiddenError("the site role does not cancel orders");
  const orderId = assertUuid(input.orderId, "orderId");
  const reason = assertText(input.reason, "reason", 500);
  if (input.documentedLosses !== undefined) assertWholeSum(input.documentedLosses, "documentedLosses", 0);
  if (input.assemblyDoneBp !== undefined) assertWholeSum(input.assemblyDoneBp, "assemblyDoneBp", 0, 10_000);

  const order = await sales.getOrder(r.db, orderId);
  if (!order) throw new NotFoundError("order");
  // A repeated request names the point the first one had, so that the repeat is recognised as one.
  const stored = (order.cancel as { point?: CancelPoint } | null)?.point;
  const point = order.status === "cancelling" ? stored : POINT_BY_STATUS[order.status];
  if (point === undefined) return { ok: false, error: "invalid_transition" };

  // The amounts are placeholders: dispatch replaces them with the ones it calculates from the database.
  const placeholder: CancelSettlement = {
    feeEarned: sum(0),
    feeToRefund: sum(0),
    feeToInvoice: sum(0),
    fundsToRefund: sum(0),
    partsGoTo: "none",
    dueBy: r.now(),
  };
  const event: CancelEventInput = {
    type: "CANCEL",
    point,
    reason,
    settlement: placeholder,
    ...(input.assemblyDoneBp === undefined ? {} : { assemblyDoneBp: input.assemblyDoneBp }),
    ...(input.documentedLosses === undefined ? {} : { documentedLosses: input.documentedLosses }),
  };
  return dispatch(orderId, event, actor, r);
}
