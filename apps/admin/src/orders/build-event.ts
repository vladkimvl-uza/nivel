// A form of the card -> an event of the automaton. Only the shape is made here: ids and a time that a person chose. No
// sum and no status is calculated; the services check the facts behind the ids (ARCHITECTURE 4.9, 4.13).
import { OrderEventSchema, UuidSchema } from "@nivel/contracts/orders";
import type { OrderEvent } from "@nivel/domain/order";
import type { OrdersPermission } from "./access.ts";

export interface FormInput {
  get(name: string): string | null;
  getAll(name: string): string[];
}

export type BuiltEvent = { ok: true; event: OrderEvent } | { ok: false; message: string };

/** A whole sum typed by a person: digits, spaces allowed between groups. Anything else is null. */
export function parseSum(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const digits = raw.replace(/\s+/g, "");
  if (!/^\d{1,15}$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The value of a datetime-local field is the wall clock of Tashkent (UTC+5, no summer time). */
export function parseTashkentLocal(raw: string | null | undefined): Date | null {
  const m = LOCAL.exec(raw ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59) return null;
  return new Date(probe.getTime() - 5 * 3_600_000);
}

const PERMISSION: Record<string, OrdersPermission> = {
  REVISE: "quotes.write",
  FEE_PREPAID: "orders.settle",
  FUNDS_RECEIVED: "orders.settle",
  MEETING_DONE: "orders.settle",
  START_PURCHASE: "orders.settle",
  PURCHASE_DONE: "orders.settle",
  REMAINDER_SETTLED: "orders.settle",
  MATERIALS_ACCEPTED: "orders.settle",
  DISPATCH: "orders.settle",
  HANDOVER: "orders.settle",
  PODBOR_DELIVERED: "orders.settle",
  CANCEL_SETTLED: "orders.settle",
  CANCEL: "orders.cancel",
  ASSEMBLED: "assembly.write",
  TESTS_PASSED: "assembly.write",
};

/** The permission a role needs to send the event; null for an event no screen sends. */
export function permissionOf(type: string): OrdersPermission | null {
  return Object.hasOwn(PERMISSION, type) ? (PERMISSION[type] as OrdersPermission) : null;
}

const NO_PAYLOAD = new Set([
  "REVISE",
  "MEETING_DONE",
  "START_PURCHASE",
  "PURCHASE_DONE",
  "ASSEMBLED",
  "DISPATCH",
  "CANCEL_SETTLED",
]);

const bad = (message: string): BuiltEvent => ({ ok: false, message });
const isId = (v: string | null): v is string => v !== null && UuidSchema.safeParse(v).success;

export function buildEvent(type: string, form: FormInput, ctx: { orderId: string }): BuiltEvent {
  if (NO_PAYLOAD.has(type)) return parse({ type });
  switch (type) {
    case "FEE_PREPAID": {
      const paymentId = form.get("paymentId");
      return isId(paymentId) ? parse({ type, paymentId }) : bad("Выберите подтверждённый платёж.");
    }
    case "FUNDS_RECEIVED": {
      const paymentIds = form.getAll("paymentIds").filter((v) => v !== "");
      const receivedAt = parseTashkentLocal(form.get("receivedAt"));
      if (paymentIds.length === 0 || !paymentIds.every((v) => isId(v))) return bad("Отметьте подтверждённые переводы.");
      if (!receivedAt) return bad("Укажите, когда деньги поступили на счёт.");
      return parse({ type, paymentIds, receivedAt });
    }
    case "REMAINDER_SETTLED": {
      const refund = form.get("refundPaymentId");
      if (refund === null || refund === "") return parse({ type });
      return isId(refund) ? parse({ type, refundPaymentId: refund }) : bad("Платёж возврата выбран неверно.");
    }
    case "MATERIALS_ACCEPTED": {
      const actId = form.get("actId");
      return isId(actId) ? parse({ type, actId }) : bad("Выберите подписанный акт приёма материала.");
    }
    case "TESTS_PASSED":
      // The passport of an order is the row whose key is the order id (contracts/orders/events.ts).
      return parse({ type, passportId: ctx.orderId });
    case "HANDOVER": {
      const actId = form.get("actId");
      const finalPaymentId = form.get("finalPaymentId");
      if (!isId(actId)) return bad("Выберите акт сдачи.");
      if (!isId(finalPaymentId)) return bad("Выберите подтверждённую окончательную плату.");
      return parse({ type, actId, finalPaymentId });
    }
    case "PODBOR_DELIVERED": {
      const paymentId = form.get("paymentId");
      return isId(paymentId) ? parse({ type, paymentId }) : bad("Выберите подтверждённую плату за «Подбор».");
    }
    default:
      // ACCEPT, OBJECTION, REPORT_ACCEPTED are the customer's; EXPIRE, CLOSE the system's; SEND_* and PURCHASE_RECORDED
      // have their own scenarios (quotes.send, purchases.record, reports.send); CANCEL goes through orders.cancel.
      return bad("Это действие выполняется не отсюда.");
  }
}

function parse(candidate: unknown): BuiltEvent {
  const checked = OrderEventSchema.safeParse(candidate);
  return checked.success ? { ok: true, event: checked.data } : bad("Данные события заполнены неверно.");
}
