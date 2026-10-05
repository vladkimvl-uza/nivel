import { NotImplementedError } from "../errors.ts";
import type { FeeSettings } from "../fee/types.ts";
import type {
  Actor,
  CustomerStatus,
  OrderApi,
  OrderEvent,
  OrderSnapshot,
  OrderStatus,
  TransitionResult,
  WorkCalendar,
} from "./types.ts";

export type * from "./types.ts";

export function transition(
  _o: OrderSnapshot,
  _e: OrderEvent,
  _actor: Actor,
  _now: Date,
  _cal: WorkCalendar,
  _s: FeeSettings,
): TransitionResult {
  throw new NotImplementedError("order.transition");
}
export function customerStatus(_s: OrderStatus): CustomerStatus {
  throw new NotImplementedError("order.customerStatus");
}

export const orderApi = { transition, customerStatus } satisfies OrderApi;
