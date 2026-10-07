// The buttons of the card of an order. The status machine decides what is allowed (ARCHITECTURE 4.9): this module only
// reads the table of the domain (`orderTransitionTable`) for the status and the role, and says how each event is made on
// the screen. The services decide again when the button is pressed; their refusal is shown as text.
import { type OrderEvent, type OrderStatus, orderTransitionTable } from "@nivel/domain/order";
import type { Role } from "../auth/roles.ts";

type EventType = OrderEvent["type"];

export interface EventAction {
  type: EventType;
  label: string;
  /** "button": one press; "form": needs a choice or a text; "elsewhere": made on its own screen (the estimate, the purchase, the report). */
  ui: "button" | "form" | "elsewhere";
  /** Where the event is made, for "elsewhere" (a section of the card). */
  section?: "quote" | "purchases" | "report";
  hint?: string;
}

/** What the owner and the assistant can send. Events of the customer and the system are not here: nobody presses them. */
export const ACTIONS = {
  SEND_ESTIMATE: { type: "SEND_ESTIMATE", label: "Отправить смету", ui: "elsewhere", section: "quote" },
  REVISE: { type: "REVISE", label: "Вернуть смету в работу", ui: "button", hint: "Новая версия сметы." },
  FEE_PREPAID: {
    type: "FEE_PREPAID",
    label: "Аванс платы получен",
    ui: "form",
    hint: "Выберите подтверждённый платёж с номером чека.",
  },
  FUNDS_RECEIVED: {
    type: "FUNDS_RECEIVED",
    label: "Деньги на закупку получены",
    ui: "form",
    hint: "Подтверждённые переводы на счёт ИП.",
  },
  MEETING_DONE: { type: "MEETING_DONE", label: "Встреча или видеозвонок состоялись", ui: "button" },
  START_PURCHASE: { type: "START_PURCHASE", label: "Начать закупку", ui: "button" },
  PURCHASE_RECORDED: { type: "PURCHASE_RECORDED", label: "Записать покупку", ui: "elsewhere", section: "purchases" },
  PURCHASE_DONE: { type: "PURCHASE_DONE", label: "Закупки закрыты", ui: "button" },
  SEND_REPORT: { type: "SEND_REPORT", label: "Отправить отчёт клиенту", ui: "elsewhere", section: "report" },
  REMAINDER_SETTLED: {
    type: "REMAINDER_SETTLED",
    label: "Свести остаток",
    ui: "form",
    hint: "Поступило должно равняться закуплено плюс возвращено.",
  },
  MATERIALS_ACCEPTED: {
    type: "MATERIALS_ACCEPTED",
    label: "Материал клиента принят",
    ui: "form",
    hint: "Нужен подписанный акт приёма материала.",
  },
  ASSEMBLED: { type: "ASSEMBLED", label: "Сборка закончена", ui: "button" },
  TESTS_PASSED: {
    type: "TESTS_PASSED",
    label: "Тесты пройдены",
    ui: "button",
    hint: "Нужен паспорт сборки: тест от шести часов без ошибок.",
  },
  DISPATCH: { type: "DISPATCH", label: "Передать в доставку", ui: "button" },
  HANDOVER: {
    type: "HANDOVER",
    label: "Передать клиенту",
    ui: "form",
    hint: "Нужны акт сдачи и окончательная плата через QR с чеком.",
  },
  PODBOR_DELIVERED: { type: "PODBOR_DELIVERED", label: "«Подбор» передан", ui: "form" },
  CANCEL: { type: "CANCEL", label: "Отменить заказ", ui: "form", hint: "Расчёты с клиентом считает сервер." },
  CANCEL_SETTLED: { type: "CANCEL_SETTLED", label: "Расчёты по отмене завершены", ui: "button" },
} as const satisfies Record<string, EventAction>;

/** Events of money: not for the assistant (ARCHITECTURE 4.9: the assistant sends none of them). */
export const MONEY_EVENTS: readonly EventType[] = [
  "FEE_PREPAID",
  "FUNDS_RECEIVED",
  "START_PURCHASE",
  "REMAINDER_SETTLED",
  "HANDOVER",
  "CANCEL",
  "CANCEL_SETTLED",
  "SEND_ESTIMATE",
];

/** The order of the statuses on the board: the road of an order from left to right. */
export const STATUS_ORDER: readonly OrderStatus[] = [
  "estimate_draft",
  "estimate_sent",
  "estimate_expired",
  "accepted",
  "purchasing",
  "report_due",
  "report_sent",
  "settled",
  "assembling",
  "testing",
  "ready",
  "delivering",
  "handed_over",
  "closed",
  "podbor_delivered",
  "cancelling",
  "cancelled",
];

const TABLE = orderTransitionTable();
const isAction = (type: string): type is keyof typeof ACTIONS => Object.hasOwn(ACTIONS, type);

/** Events that belong to one kind of order only: the "Podbor" is delivered, a PC is not. */
const ONLY_FOR_KIND: Partial<Record<EventType, string>> = { PODBOR_DELIVERED: "podbor" };

/** The actions the role may start in this status for this kind of order, in the order of the table. */
export function actionsFor(status: OrderStatus, role: Role, kind = "pc"): EventAction[] {
  if (role !== "owner" && role !== "assistant") return [];
  const seen = new Set<string>();
  const out: EventAction[] = [];
  for (const row of TABLE) {
    if (row.from !== status || !row.actors.includes(role) || seen.has(row.event) || !isAction(row.event)) continue;
    const only = ONLY_FOR_KIND[row.event];
    if (only !== undefined && only !== kind) continue;
    seen.add(row.event);
    out.push(ACTIONS[row.event]);
  }
  return out;
}
