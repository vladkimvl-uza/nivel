// The jobs of the order calendar (the `schedule` effects of the automaton and the reminder after ACCEPT): the outbox sends each at its time
// to the queue `orders.scheduled` with its name in the data. The handler looks at the order when the job fires; the facts may
// have changed since it was queued (the report accepted, the money received), and then there is nothing to do.
import type { WorkCalendar } from "@nivel/domain/calendar";
import { PermanentJobError } from "../../queues/define.ts";
import { isUuid } from "../../queues/ids.ts";
import { OUTBOX_JOB } from "../outbox/routes.ts";
import { type RemindersDeps, remindAftercare, remindRefundDue, remindReportDue } from "./reminders.ts";
import { deemAccepted, expireEstimate, remindAccept, type TermsDeps } from "./terms.ts";

export interface ScheduledDeps extends TermsDeps, RemindersDeps {
  calendar(): Promise<WorkCalendar>;
}

const HOUR_MS = 3_600_000;

export async function handleScheduled(deps: ScheduledDeps, data: Record<string, unknown>): Promise<void> {
  const { job, orderId } = data;
  if (typeof job !== "string" || !isUuid(orderId)) {
    throw new PermanentJobError("orders.scheduled: the job must name itself and the order");
  }
  const at = typeof data.at === "string" && !Number.isNaN(Date.parse(data.at)) ? new Date(data.at) : deps.now();
  switch (job) {
    case "objection_window":
      await deemAccepted(deps, orderId);
      return;
    case "estimate_expiry":
      await expireEstimate(deps, orderId);
      return;
    case OUTBOX_JOB.ACCEPT_REMINDER:
      await remindAccept(deps, orderId);
      return;
    case "report_due": {
      // Two jobs are set at the purchases: the target (reportDueAt, 24 hours) and the latest term (a day later).
      const order = await deps.store.order(orderId);
      const last = order?.reportDueAt != null && at.getTime() - order.reportDueAt.getTime() > HOUR_MS;
      await remindReportDue(deps, orderId, { last });
      return;
    }
    case "refund_due":
      await remindRefundDue(deps, orderId);
      return;
    case "aftercare":
      await remindAftercare(deps, orderId, at);
      return;
    case "warranty_end":
      // The warranty runs by `warrantyUntil` and the automaton of the warranty case (4.10): there is no status to change here.
      deps.log.info({ orderId }, "warranty_end: the term of the warranty of the order has ended");
      return;
    default:
      throw new PermanentJobError(`orders.scheduled: unknown job ${job}`);
  }
}
