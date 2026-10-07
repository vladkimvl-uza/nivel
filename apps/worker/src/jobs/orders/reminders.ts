// Reminders to the owner (ARCHITECTURE 7.2, 9). All of them go through the outbox as a message to the owner's group, into the topic
// of the order or of the request, with a dedupe key: a job that runs twice tells the owner once.
//  - a request nobody has answered for 15 minutes: only in the hours of answers (10:00-19:00 Tashkent, Monday to Saturday, no
//    holidays of ops.settings), and the 15 minutes of a request that came at night begin at the next opening;
//  - the report of the purchases (24 hours, 48 at the latest), the refund of the remainder, the calls after the handover.
import type { ops } from "@nivel/db/repos";
import type { WorkCalendar } from "@nivel/domain/calendar";
import type { Logger } from "pino";
import type { OrdersStore } from "./store.ts";

export const LEAD_REMINDER_MINUTES = 15;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3_600_000;
const PRIORITY = 3;
const SWEEP_LIMIT = 100;

export interface RemindersDeps {
  now(): Date;
  log: Logger;
  store: OrdersStore;
  calendar(): Promise<WorkCalendar>;
  enqueue(input: ops.OutboxInput): Promise<unknown>;
}

/**
 * The moment the minutes of waiting begin: the moment of the request when it came in the hours of answers, otherwise the next
 * opening (the same morning for a request before the opening, the next working day for one after the closing, on Sunday
 * or on a holiday).
 */
export function leadReminderStart(cal: WorkCalendar, createdAt: Date): Date {
  if (cal.isResponseHours(createdAt)) return createdAt;
  // The first working day not before the day of the request: its opening is later than the request when the request came
  // before the opening or on a day off.
  const opening = cal.nextWorkingDayStart(new Date(createdAt.getTime() - DAY_MS));
  if (opening.getTime() > createdAt.getTime()) return opening;
  return cal.nextWorkingDayStart(createdAt);
}

/** True when the request has waited the minutes since its start and now is a moment when the owner may be told. */
export function isLeadReminderDue(
  cal: WorkCalendar,
  createdAt: Date,
  now: Date,
  minutes = LEAD_REMINDER_MINUTES,
): boolean {
  if (!cal.isResponseHours(now)) return false;
  return now.getTime() >= leadReminderStart(cal, createdAt).getTime() + minutes * MINUTE_MS;
}

export async function sweepLeadReminders(
  deps: RemindersDeps,
): Promise<{ reminded: number; waiting: number; closed: number }> {
  const now = deps.now();
  const result = { reminded: 0, waiting: 0, closed: 0 };
  const leads = await deps.store.unansweredLeads(now, SWEEP_LIMIT);
  if (leads.length === 0) return result;
  const cal = await deps.calendar();
  const open = cal.isResponseHours(now);
  for (const lead of leads) {
    if (!open) {
      result.closed += 1;
      continue;
    }
    if (!isLeadReminderDue(cal, lead.createdAt, now)) {
      result.waiting += 1;
      continue;
    }
    await deps.enqueue({
      kind: "telegram_message",
      dedupeKey: `lead:${lead.id}:no_answer_15m`,
      priority: PRIORITY,
      payload: {
        target: "owner_topic",
        templateKey: "reminder.lead_no_answer",
        leadId: lead.id,
        params: { number: lead.number, minutes: LEAD_REMINDER_MINUTES },
      },
    });
    result.reminded += 1;
  }
  return result;
}

// ---- reminders of an order ----------------------------------------------------------------------------------------------

export type Reminded = { outcome: "reminded" } | { outcome: "not_needed" };

function toOwner(
  deps: RemindersDeps,
  o: { id: string; number: string },
  key: string,
  templateKey: string,
  params: Record<string, unknown>,
) {
  return deps.enqueue({
    kind: "telegram_message",
    dedupeKey: `order:${o.id}:${key}`,
    priority: PRIORITY,
    payload: { target: "owner_topic", templateKey, orderId: o.id, orderNumber: o.number, params },
  });
}

/** The report of the purchases is due (`last`: the latest term of 48 hours): the owner is told while the report is not sent. */
export async function remindReportDue(
  deps: RemindersDeps,
  orderId: string,
  opts: { last: boolean },
): Promise<Reminded> {
  const order = await deps.store.order(orderId);
  if (order === null || order.status !== "report_due") return { outcome: "not_needed" };
  await toOwner(deps, order, `report_due:${opts.last ? "last" : "target"}`, "reminder.report_due", { last: opts.last });
  return { outcome: "reminded" };
}

/** The refund of the remainder (or a refund of a cancellation) is due: the owner is told while it is expected and not confirmed. */
export async function remindRefundDue(deps: RemindersDeps, orderId: string): Promise<Reminded> {
  const order = await deps.store.order(orderId);
  if (order === null || !(await deps.store.refundOpen(orderId))) return { outcome: "not_needed" };
  await toOwner(deps, order, "refund_due", "reminder.refund_due", {});
  return { outcome: "reminded" };
}

/** Whole days between the handover and the moment of the job: 7 or 30. */
export function aftercareDays(handedOverAt: Date | null, at: Date): number | null {
  if (handedOverAt === null) return null;
  return Math.round((at.getTime() - handedOverAt.getTime()) / DAY_MS);
}

export async function remindAftercare(
  deps: RemindersDeps,
  orderId: string,
  at: Date,
): Promise<{ outcome: "reminded"; days: number } | { outcome: "not_needed" }> {
  const order = await deps.store.order(orderId);
  // `closed` follows the handover at once (CLOSE as the system), so by the seventh day the order is closed.
  if (order === null || (order.status !== "handed_over" && order.status !== "closed")) return { outcome: "not_needed" };
  const days = aftercareDays(order.handedOverAt, at);
  if (days === null) return { outcome: "not_needed" };
  await toOwner(deps, order, `aftercare:${days}`, "reminder.aftercare", { days });
  return { outcome: "reminded", days };
}
