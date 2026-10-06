import type { FeeSettings } from "../fee/types.ts";
import { RULES, type Rule } from "./rules.ts";
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

export { FIRST_ORDER_MEETING_FROM } from "./rules.ts";
export type * from "./types.ts";

/** Rules by "status|event type"; a Map, so that keys such as "constructor" are never found by accident. */
const INDEX = new Map<string, Rule>(RULES.flatMap((r) => r.from.map((from) => [`${from}|${r.event}`, r] as const)));

export interface TransitionRow {
  from: OrderStatus;
  event: OrderEvent["type"];
  to: OrderStatus;
  actors: readonly Actor[];
}

/** The table of transitions (ARCHITECTURE 4.9) as data: one row per status and event. For tests, docs and admin UI. */
export function orderTransitionTable(): TransitionRow[] {
  return RULES.flatMap((r) => r.from.map((from) => ({ from, event: r.event, to: r.to, actors: [...r.actors] })));
}

/**
 * Pure order automaton. Checks, in this order: the event is allowed in the status (invalid_transition), the actor
 * may send it (actor_not_allowed), the guards of the row. Returns the next status and the effects to execute after
 * the transaction commits; never changes its arguments.
 */
export function transition(
  o: OrderSnapshot,
  e: OrderEvent,
  actor: Actor,
  now: Date,
  cal: WorkCalendar,
  s: FeeSettings,
): TransitionResult {
  if (Number.isNaN(now.getTime())) throw new RangeError("transition: invalid clock");
  const type: unknown = e?.type;
  const row = typeof type === "string" ? INDEX.get(`${o.status}|${type}`) : undefined;
  if (row === undefined) return { ok: false, error: "invalid_transition" };
  if (!row.actors.includes(actor)) return { ok: false, error: "actor_not_allowed" };
  const ctx = { o, e, now, cal, s };
  const error = row.guard?.(ctx);
  if (error !== undefined) return { ok: false, error };
  return { ok: true, next: row.to, effects: row.effects?.(ctx) ?? [] };
}

// ARCHITECTURE 4.9, projection for the customer (CONCEPT 5.9).
const PROJECTION = {
  estimate_draft: "submitted",
  estimate_sent: "submitted",
  estimate_expired: "submitted",
  accepted: "estimate_confirmed",
  purchasing: "purchasing",
  report_due: "purchasing",
  report_sent: "receipts_summary",
  settled: "receipts_summary",
  assembling: "assembly_test",
  testing: "assembly_test",
  ready: "ready",
  delivering: "ready",
  handed_over: "handed_over",
  closed: "handed_over",
  podbor_delivered: "handed_over",
  cancelling: "cancelled",
  cancelled: "cancelled",
} satisfies Record<OrderStatus, CustomerStatus>;
/** A Map built from the object: the compiler demands every status, and keys such as "constructor" are never found. */
const CUSTOMER_STATUS = new Map<string, CustomerStatus>(Object.entries(PROJECTION));

export function customerStatus(s: OrderStatus): CustomerStatus {
  const out = CUSTOMER_STATUS.get(s);
  if (out === undefined) throw new RangeError(`customerStatus: unknown status ${JSON.stringify(s)}`);
  return out;
}

/**
 * customerStatus plus the split of `accepted` that the status alone cannot give: "waiting for the prepayment"
 * (estimate_confirmed) or "prepayment received" (prepaid, once the fee advance is confirmed).
 */
export function customerStatusFor(s: OrderStatus, flags: Partial<OrderSnapshot["flags"]>): CustomerStatus {
  return s === "accepted" && flags.feePrepaid ? "prepaid" : customerStatus(s);
}

export const orderApi = { transition, customerStatus } satisfies OrderApi;
