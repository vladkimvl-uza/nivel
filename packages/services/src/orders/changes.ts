// The fields of the order written together with a status change (sales.apply_transition, p_changes). The database
// whitelists them by the pair (actor, event) and a customer writes a field once: here only fields that are still
// empty are put into a change of a customer, and every field of the effects "set" of the domain is mapped to its column.
import type { Actor, Effect, OrderEvent } from "@nivel/domain/order";
import type { OrderRow } from "./snapshot.ts";

type SetField = Extract<Effect, { kind: "set" }>["field"];

const SET_COLUMN: Record<SetField, keyof OrderRow & string> = {
  purchaseNotBefore: "purchaseNotBefore",
  warrantyUntil: "warrantyUntil",
  reportDueAt: "reportDueAt",
  objectionUntil: "objectionUntil",
  refundDueAt: "refundDueAt",
  podborCreditUntil: "podborCreditUntil",
};

/** snake_case names of the columns apply_transition accepts. */
const SNAKE: Record<string, string> = {
  purchaseNotBefore: "purchase_not_before",
  warrantyUntil: "warranty_until",
  reportDueAt: "report_due_at",
  objectionUntil: "objection_until",
  refundDueAt: "refund_due_at",
  podborCreditUntil: "podbor_credit_until",
  handedOverAt: "handed_over_at",
  acceptedAt: "accepted_at",
  offerVersionUzId: "offer_version_uz_id",
  offerVersionRuId: "offer_version_ru_id",
};

export interface ChangeInput {
  order: OrderRow;
  event: OrderEvent;
  actor: Actor;
  effects: readonly Effect[];
  now: Date;
  /** The current versions of the offer: fixed on the order at the acceptance. */
  offers: { uzId: string | null; ruId: string | null };
  /** Documented losses the owner entered together with a cancellation. */
  documentedLosses?: number;
}

export function buildChanges(i: ChangeInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const { order, actor } = i;
  /** A customer writes only what is empty; the owner may correct. */
  const put = (column: keyof OrderRow & string, value: unknown) => {
    if (actor === "customer" && order[column] !== null && order[column] !== undefined) return;
    out[SNAKE[column] ?? toSnake(column)] = value instanceof Date ? value.toISOString() : value;
  };

  switch (i.event.type) {
    case "FEE_PREPAID":
      out.fee_prepaid = true;
      break;
    case "FUNDS_RECEIVED":
      out.funds_received = true;
      out.funds_received_at = new Date(i.event.receivedAt).toISOString();
      break;
    case "MEETING_DONE":
      out.first_order_meeting_done = true;
      break;
    case "ACCEPT":
      put("acceptedAt", i.now);
      if (i.offers.uzId) put("offerVersionUzId", i.offers.uzId);
      if (i.offers.ruId) put("offerVersionRuId", i.offers.ruId);
      break;
    case "HANDOVER":
      put("handedOverAt", i.now);
      break;
    case "CANCEL":
      out.cancel = {
        point: i.event.point,
        reason: i.event.reason,
        settlement: JSON.parse(JSON.stringify(i.event.settlement)),
        at: i.now.toISOString(),
      };
      if (i.documentedLosses !== undefined && i.documentedLosses !== order.documentedLossesSum) {
        out.documented_losses_sum = i.documentedLosses;
      }
      break;
    default:
      break;
  }

  for (const effect of i.effects) {
    if (effect.kind === "set") put(SET_COLUMN[effect.field], effect.at);
  }
  return out;
}

function toSnake(column: string): string {
  return column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
