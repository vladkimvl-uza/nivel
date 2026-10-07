import type { ops } from "@nivel/db/repos";
import { createWorkCalendar } from "@nivel/domain/calendar";
import { describe, expect, it } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import {
  aftercareDays,
  isLeadReminderDue,
  LEAD_REMINDER_MINUTES,
  leadReminderStart,
  type RemindersDeps,
  remindAftercare,
  remindRefundDue,
  remindReportDue,
  sweepLeadReminders,
} from "./reminders.ts";
import type { OrderFacts, OrdersStore, UnansweredLead } from "./store.ts";

// Monday 12 October 2026. Tuesday 13 October is a holiday in these tests. Sunday is the 11th and the 18th.
const cal = createWorkCalendar(["2026-10-13"], { from: "10:00", to: "19:00" });
const at = (iso: string) => new Date(`${iso}+05:00`);

describe("leadReminderStart: when the 15 minutes begin to count", () => {
  it("is the moment of the request when it came in the hours of answers", () => {
    expect(leadReminderStart(cal, at("2026-10-12T10:00:00"))).toEqual(at("2026-10-12T10:00:00"));
    expect(leadReminderStart(cal, at("2026-10-12T14:30:00"))).toEqual(at("2026-10-12T14:30:00"));
    expect(leadReminderStart(cal, at("2026-10-12T18:59:00"))).toEqual(at("2026-10-12T18:59:00"));
    expect(leadReminderStart(cal, at("2026-10-17T12:00:00"))).toEqual(at("2026-10-17T12:00:00")); // Saturday
  });

  it("is the opening of the day for a request before the opening", () => {
    expect(leadReminderStart(cal, at("2026-10-12T07:30:00"))).toEqual(at("2026-10-12T10:00:00"));
    expect(leadReminderStart(cal, at("2026-10-12T00:00:00"))).toEqual(at("2026-10-12T10:00:00"));
  });

  it("is the opening of the next working day for a request after the closing", () => {
    expect(leadReminderStart(cal, at("2026-10-12T19:00:00"))).toEqual(at("2026-10-14T10:00:00")); // the 13th is a holiday
    expect(leadReminderStart(cal, at("2026-10-12T23:59:00"))).toEqual(at("2026-10-14T10:00:00"));
    expect(leadReminderStart(cal, at("2026-10-14T20:00:00"))).toEqual(at("2026-10-15T10:00:00"));
  });

  it("skips Sunday and a holiday", () => {
    expect(leadReminderStart(cal, at("2026-10-11T12:00:00"))).toEqual(at("2026-10-12T10:00:00")); // Sunday noon -> Monday
    expect(leadReminderStart(cal, at("2026-10-13T12:00:00"))).toEqual(at("2026-10-14T10:00:00")); // the holiday
    expect(leadReminderStart(cal, at("2026-10-17T19:30:00"))).toEqual(at("2026-10-19T10:00:00")); // Saturday evening -> Monday
  });
});

describe("isLeadReminderDue: the reminder of 15 minutes without an answer", () => {
  const created = at("2026-10-12T11:00:00");

  it("is not due before 15 minutes have passed, and is due from the fifteenth minute", () => {
    expect(LEAD_REMINDER_MINUTES).toBe(15);
    expect(isLeadReminderDue(cal, created, at("2026-10-12T11:14:59"))).toBe(false);
    expect(isLeadReminderDue(cal, created, at("2026-10-12T11:15:00"))).toBe(true);
    expect(isLeadReminderDue(cal, created, at("2026-10-12T13:00:00"))).toBe(true);
  });

  it("is never due on Sunday", () => {
    const friday = at("2026-10-16T18:50:00");
    expect(isLeadReminderDue(cal, friday, at("2026-10-18T12:00:00"))).toBe(false);
    expect(isLeadReminderDue(cal, at("2026-10-10T12:00:00"), at("2026-10-11T12:00:00"))).toBe(false);
    expect(isLeadReminderDue(cal, at("2026-10-10T12:00:00"), at("2026-10-11T10:00:00"))).toBe(false);
  });

  it("is never due before 10:00 or from 19:00", () => {
    const yesterday = at("2026-10-12T15:00:00");
    expect(isLeadReminderDue(cal, yesterday, at("2026-10-14T09:59:59"))).toBe(false);
    expect(isLeadReminderDue(cal, yesterday, at("2026-10-14T10:00:00"))).toBe(true);
    expect(isLeadReminderDue(cal, yesterday, at("2026-10-14T18:59:59"))).toBe(true);
    expect(isLeadReminderDue(cal, yesterday, at("2026-10-14T19:00:00"))).toBe(false);
    expect(isLeadReminderDue(cal, yesterday, at("2026-10-14T23:00:00"))).toBe(false);
  });

  it("is never due on a holiday of the owner's calendar", () => {
    expect(isLeadReminderDue(cal, at("2026-10-12T15:00:00"), at("2026-10-13T12:00:00"))).toBe(false);
  });

  it("counts the 15 minutes from the opening for a request that came at night, not from the night", () => {
    const night = at("2026-10-12T23:30:00");
    expect(isLeadReminderDue(cal, night, at("2026-10-14T10:00:00"))).toBe(false);
    expect(isLeadReminderDue(cal, night, at("2026-10-14T10:14:59"))).toBe(false);
    expect(isLeadReminderDue(cal, night, at("2026-10-14T10:15:00"))).toBe(true);
    const early = at("2026-10-14T08:00:00");
    expect(isLeadReminderDue(cal, early, at("2026-10-14T10:10:00"))).toBe(false);
    expect(isLeadReminderDue(cal, early, at("2026-10-14T10:15:00"))).toBe(true);
  });

  it("counts a request of Saturday evening from Monday morning", () => {
    const sat = at("2026-10-17T19:20:00");
    expect(isLeadReminderDue(cal, sat, at("2026-10-17T19:40:00"))).toBe(false); // closed
    expect(isLeadReminderDue(cal, sat, at("2026-10-18T11:00:00"))).toBe(false); // Sunday
    expect(isLeadReminderDue(cal, sat, at("2026-10-19T10:14:00"))).toBe(false);
    expect(isLeadReminderDue(cal, sat, at("2026-10-19T10:15:00"))).toBe(true);
  });

  it("is due at the last minute of the hours and not at the closing itself, for a request that has waited", () => {
    const early = at("2026-10-12T10:00:00");
    expect(isLeadReminderDue(cal, early, at("2026-10-12T18:59:00"))).toBe(true);
    expect(isLeadReminderDue(cal, early, at("2026-10-12T19:00:00"))).toBe(false);
  });
});

// ---- the sweep and the owner's reminders ----------------------------------------------------------------------------------

function setup(over: { leads?: UnansweredLead[]; now?: Date; order?: OrderFacts | null; refundOpen?: boolean } = {}) {
  const clock = new FakeClock(over.now ?? at("2026-10-12T11:20:00"));
  const enqueued: ops.OutboxInput[] = [];
  const { log } = recordingLogger();
  const store: OrdersStore = {
    deemedCandidates: async () => [],
    expiryCandidates: async () => [],
    order: async () => (over.order === undefined ? null : over.order),
    quoteValidUntil: async () => null,
    refundOpen: async () => over.refundOpen ?? false,
    unansweredLeads: async () => over.leads ?? [],
  };
  const deps: RemindersDeps = {
    now: clock.now,
    log,
    store,
    calendar: async () => cal,
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
  };
  return { deps, clock, enqueued };
}

describe("sweepLeadReminders", () => {
  const lead = (id: string, createdAt: Date): UnansweredLead => ({ id, number: `L-2026-000${id}`, createdAt });

  it("tells the owner in the topic of the request about the requests that have waited 15 minutes, once for each", async () => {
    const t = setup({ leads: [lead("1", at("2026-10-12T11:00:00")), lead("2", at("2026-10-12T11:10:00"))] });
    expect(await sweepLeadReminders(t.deps)).toEqual({ reminded: 1, waiting: 1, closed: 0 });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "lead:1:no_answer_15m",
        priority: 3,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.lead_no_answer",
          leadId: "1",
          params: { number: "L-2026-0001", minutes: 15 },
        },
      },
    ]);
  });

  it("says nothing on Sunday, before 10:00 and from 19:00, however long the requests have waited", async () => {
    const waiting = [lead("1", at("2026-10-10T12:00:00"))];
    for (const now of [
      at("2026-10-11T12:00:00"),
      at("2026-10-12T09:59:00"),
      at("2026-10-12T19:00:00"),
      at("2026-10-13T12:00:00"),
    ]) {
      const t = setup({ leads: waiting, now });
      expect(await sweepLeadReminders(t.deps)).toEqual({ reminded: 0, waiting: 0, closed: 1 });
      expect(t.enqueued).toEqual([]);
    }
  });

  it("does nothing without requests", async () => {
    const t = setup();
    expect(await sweepLeadReminders(t.deps)).toEqual({ reminded: 0, waiting: 0, closed: 0 });
  });
});

const orderFacts = (over: Partial<OrderFacts> = {}): OrderFacts => ({
  id: "o-1",
  number: "NV-2026-0001",
  status: "report_due",
  customerId: "c-1",
  feePrepaid: true,
  fundsReceived: true,
  objectionUntil: null,
  reportDueAt: null,
  handedOverAt: null,
  ...over,
});

describe("remindReportDue: the report is due 24 hours after the purchases, 48 at the latest", () => {
  it("tells the owner in the topic of the order while the report has not been sent", async () => {
    const t = setup({ order: orderFacts() });
    expect(await remindReportDue(t.deps, "o-1", { last: false })).toEqual({ outcome: "reminded" });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "order:o-1:report_due:target",
        priority: 3,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.report_due",
          orderId: "o-1",
          orderNumber: "NV-2026-0001",
          params: { last: false },
        },
      },
    ]);
    await remindReportDue(t.deps, "o-1", { last: true });
    expect(t.enqueued[1]?.dedupeKey).toBe("order:o-1:report_due:last");
  });

  it("is silent when the report has gone out or the order is gone", async () => {
    for (const o of [orderFacts({ status: "report_sent" }), orderFacts({ status: "cancelled" }), null]) {
      const t = setup({ order: o });
      expect(await remindReportDue(t.deps, "o-1", { last: true })).toEqual({ outcome: "not_needed" });
      expect(t.enqueued).toEqual([]);
    }
  });
});

describe("remindRefundDue: the refund of the remainder is due in 5 working days", () => {
  it("tells the owner while the refund is expected and not confirmed", async () => {
    const t = setup({ order: orderFacts({ status: "report_sent" }), refundOpen: true });
    expect(await remindRefundDue(t.deps, "o-1")).toEqual({ outcome: "reminded" });
    expect(t.enqueued[0]).toMatchObject({
      dedupeKey: "order:o-1:refund_due",
      payload: { templateKey: "reminder.refund_due" },
    });
  });

  it("is silent once the refund is confirmed", async () => {
    const t = setup({ order: orderFacts({ status: "settled" }), refundOpen: false });
    expect(await remindRefundDue(t.deps, "o-1")).toEqual({ outcome: "not_needed" });
  });

  it("is silent for a cancelled order whose settlement is not a remainder refund, and an order that is gone", async () => {
    expect(await remindRefundDue(setup({ order: null, refundOpen: true }).deps, "o-1")).toEqual({
      outcome: "not_needed",
    });
  });
});

describe("remindAftercare: the calls 7 and 30 days after the handover", () => {
  it("counts the days from the handover to the moment of the job", () => {
    const handed = at("2026-10-12T15:00:00");
    expect(aftercareDays(handed, new Date(handed.getTime() + 7 * 86_400_000))).toBe(7);
    expect(aftercareDays(handed, new Date(handed.getTime() + 30 * 86_400_000 + 3_600_000))).toBe(30);
    expect(aftercareDays(null, handed)).toBeNull();
  });

  it("tells the owner to call, with the number of days, for an order that was handed over", async () => {
    const handed = at("2026-10-12T15:00:00");
    const t = setup({ order: orderFacts({ status: "handed_over", handedOverAt: handed }) });
    const result = await remindAftercare(t.deps, "o-1", new Date(handed.getTime() + 7 * 86_400_000));
    expect(result).toEqual({ outcome: "reminded", days: 7 });
    expect(t.enqueued[0]).toMatchObject({
      dedupeKey: "order:o-1:aftercare:7",
      payload: { templateKey: "reminder.aftercare", orderId: "o-1", params: { days: 7 } },
    });
  });

  it("also tells for an order that is closed already: CLOSE follows the handover at once", async () => {
    const handed = at("2026-10-12T15:00:00");
    const t = setup({ order: orderFacts({ status: "closed", handedOverAt: handed }) });
    expect(await remindAftercare(t.deps, "o-1", new Date(handed.getTime() + 30 * 86_400_000))).toEqual({
      outcome: "reminded",
      days: 30,
    });
  });

  it("is silent for an order that is not handed over or has no handover date", async () => {
    const t = setup({ order: orderFacts({ status: "cancelled" }) });
    expect(await remindAftercare(t.deps, "o-1", new Date())).toEqual({ outcome: "not_needed" });
    const t2 = setup({ order: orderFacts({ status: "handed_over", handedOverAt: null }) });
    expect(await remindAftercare(t2.deps, "o-1", new Date())).toEqual({ outcome: "not_needed" });
  });
});
