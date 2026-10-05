// Frozen contract (ARCHITECTURE 4.13). Implementation — WP-07.
import { NotImplementedError } from "@nivel/domain/errors";
import type { Actor, GuardError, OrderEvent, OrderStatus } from "@nivel/domain/order";

/** admin user id, telegram user id, "system" */
export interface ActorRef {
  kind: Actor;
  id: string;
}
export type DispatchResult = { ok: true; status: OrderStatus } | { ok: false; error: GuardError };

/** Reads snapshot, calls domain.transition, then in ONE transaction: status, order_events, audit_log, ops.outbox (notify + jobs). */
export async function dispatch(_orderId: string, _event: OrderEvent, _actor: ActorRef): Promise<DispatchResult> {
  throw new NotImplementedError("services.orders.dispatch");
}
