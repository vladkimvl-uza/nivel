import type { ops } from "@nivel/db/repos";
import { createWorkCalendar } from "@nivel/domain/calendar";
import { describe, expect, it, vi } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import { FakeClock, FakeJobs, recordingLogger } from "../../queues/test-support/fakes.ts";
import { handleScheduled, type ScheduledDeps } from "./scheduled.ts";
import type { OrderFacts, OrdersStore } from "./store.ts";

const ORDER = "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11";
const at = (iso: string) => new Date(`${iso}+05:00`);

function setup(order: Partial<OrderFacts> | null, now = at("2026-10-15T10:05:00")) {
  const clock = new FakeClock(now);
  const enqueued: ops.OutboxInput[] = [];
  const dispatch = vi.fn(async () => ({ ok: true as const, status: "report_sent" as const }));
  const full: OrderFacts | null =
    order === null
      ? null
      : {
          id: ORDER,
          number: "NV-2026-0001",
          status: "report_sent",
          customerId: "c-1",
          feePrepaid: false,
          fundsReceived: false,
          objectionUntil: at("2026-10-15T10:00:00"),
          reportDueAt: null,
          handedOverAt: null,
          ...order,
        };
  const store: OrdersStore = {
    deemedCandidates: async () => [],
    expiryCandidates: async () => [],
    order: async () => full,
    quoteValidUntil: async () => at("2026-10-15T10:00:00"),
    refundOpen: async () => true,
    unansweredLeads: async () => [],
  };
  const { log } = recordingLogger();
  const deps: ScheduledDeps = {
    now: clock.now,
    log,
    store,
    dispatch,
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
    jobs: new FakeJobs(),
    calendar: async () => createWorkCalendar([], { from: "10:00", to: "19:00" }),
  };
  return { deps, dispatch, enqueued };
}

describe("handleScheduled: the jobs of the order calendar", () => {
  it("objection_window: says REPORT_DEEMED_ACCEPTED as the system after the window", async () => {
    const t = setup({});
    await handleScheduled(t.deps, { job: "objection_window", orderId: ORDER });
    expect(t.dispatch).toHaveBeenCalledWith(ORDER, { type: "REPORT_DEEMED_ACCEPTED" });
  });

  it("estimate_expiry: expires the estimate after its term", async () => {
    const t = setup({ status: "estimate_sent" });
    await handleScheduled(t.deps, { job: "estimate_expiry", orderId: ORDER });
    expect(t.dispatch).toHaveBeenCalledWith(ORDER, { type: "EXPIRE" });
  });

  it("accept_reminder: reminds the customer who has not paid", async () => {
    const t = setup({ status: "accepted" });
    await handleScheduled(t.deps, {
      job: "accept_reminder",
      orderId: ORDER,
      orderNumber: "x",
      at: "2026-10-15T10:00:00.000Z",
    });
    expect(t.enqueued[0]?.payload).toMatchObject({ target: "customer", templateKey: "order.accept_reminder" });
  });

  it("report_due: the first term is the target of 24 hours, the second (a day later) is the last", async () => {
    const target = at("2026-10-15T10:00:00");
    const first = setup({ status: "report_due", reportDueAt: target });
    await handleScheduled(first.deps, { job: "report_due", orderId: ORDER, at: target.toISOString() });
    expect(first.enqueued[0]?.payload).toMatchObject({ params: { last: false } });
    const second = setup({ status: "report_due", reportDueAt: target });
    await handleScheduled(second.deps, {
      job: "report_due",
      orderId: ORDER,
      at: new Date(target.getTime() + 86_400_000).toISOString(),
    });
    expect(second.enqueued[0]?.payload).toMatchObject({ params: { last: true } });
  });

  it("report_due: without the term of the order or the time of the job it is the first term", async () => {
    const t = setup({ status: "report_due", reportDueAt: null });
    await handleScheduled(t.deps, { job: "report_due", orderId: ORDER });
    expect(t.enqueued[0]?.payload).toMatchObject({ params: { last: false } });
  });

  it("refund_due: reminds the owner while a refund is expected", async () => {
    const t = setup({ status: "report_sent" });
    await handleScheduled(t.deps, { job: "refund_due", orderId: ORDER });
    expect(t.enqueued[0]?.payload).toMatchObject({ templateKey: "reminder.refund_due" });
  });

  it("aftercare: reminds the owner to call, with the days since the handover", async () => {
    const handed = at("2026-10-08T10:00:00");
    const t = setup({ status: "closed", handedOverAt: handed });
    await handleScheduled(t.deps, {
      job: "aftercare",
      orderId: ORDER,
      at: new Date(handed.getTime() + 7 * 86_400_000).toISOString(),
    });
    expect(t.enqueued[0]?.payload).toMatchObject({ templateKey: "reminder.aftercare", params: { days: 7 } });
  });

  it("warranty_end: nothing to do, the warranty runs by warrantyUntil (ARCHITECTURE 4.10)", async () => {
    const t = setup({});
    await handleScheduled(t.deps, { job: "warranty_end", orderId: ORDER });
    expect(t.dispatch).not.toHaveBeenCalled();
    expect(t.enqueued).toEqual([]);
  });

  it("refuses a job of the calendar that it does not know, or without an order", async () => {
    const t = setup({});
    await expect(handleScheduled(t.deps, { job: "teleport", orderId: ORDER })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    await expect(handleScheduled(t.deps, { job: "objection_window" })).rejects.toBeInstanceOf(PermanentJobError);
    // an id that is no UUID never reaches the database (its text would come back in the error of Postgres)
    await expect(
      handleScheduled(t.deps, { job: "objection_window", orderId: "x".repeat(5000) }),
    ).rejects.toBeInstanceOf(PermanentJobError);
    await expect(handleScheduled(t.deps, { job: "objection_window", orderId: 5 })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    await expect(handleScheduled(t.deps, {})).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("lets pg-boss retry when the automaton refuses with a mistake of the worker", async () => {
    const t = setup({});
    t.deps.dispatch = async () => ({ ok: false, error: "actor_not_allowed" });
    await expect(handleScheduled(t.deps, { job: "objection_window", orderId: ORDER })).rejects.toThrow(
      /actor_not_allowed/,
    );
  });
});
