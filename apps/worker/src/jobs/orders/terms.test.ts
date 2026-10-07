import type { ops } from "@nivel/db/repos";
import { describe, expect, it, vi } from "vitest";
import { jobIdOf } from "../../queues/ids.ts";
import { FakeClock, FakeJobs, recordingLogger } from "../../queues/test-support/fakes.ts";
import { QUEUE } from "../outbox/routes.ts";
import type { OrderFacts, OrdersStore } from "./store.ts";
import {
  deemAccepted,
  expireEstimate,
  failIfSweepFailed,
  remindAccept,
  sweepDeemed,
  sweepExpiry,
  type TermsDeps,
} from "./terms.ts";

const ORDER = "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11";
const UNTIL = new Date("2026-10-15T10:00:00+05:00");

function order(over: Partial<OrderFacts> = {}): OrderFacts {
  return {
    id: ORDER,
    number: "NV-2026-0001",
    status: "report_sent",
    customerId: "cust-1",
    feePrepaid: false,
    fundsReceived: false,
    objectionUntil: UNTIL,
    reportDueAt: null,
    handedOverAt: null,
    ...over,
  };
}

function setup(
  o: { order?: OrderFacts | null; dispatch?: TermsDeps["dispatch"]; validUntil?: Date | null; now?: Date } = {},
) {
  const clock = new FakeClock(o.now ?? new Date(UNTIL.getTime() + 60_000));
  const enqueued: ops.OutboxInput[] = [];
  const jobs = new FakeJobs();
  const { log, lines } = recordingLogger();
  const dispatch = vi.fn(o.dispatch ?? (async () => ({ ok: true as const, status: "report_sent" as const })));
  const store: OrdersStore = {
    deemedCandidates: async () => [ORDER],
    expiryCandidates: async () => [ORDER],
    order: async () => (o.order === undefined ? order() : o.order),
    quoteValidUntil: async () => (o.validUntil === undefined ? null : o.validUntil),
    refundOpen: async () => false,
    unansweredLeads: async () => [],
  };
  const deps: TermsDeps = {
    now: clock.now,
    log,
    store,
    dispatch,
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
    jobs,
  };
  return { deps, clock, dispatch, enqueued, jobs, lines, store };
}

describe("deemAccepted: REPORT_DEEMED_ACCEPTED strictly after the window of objections", () => {
  it("sends the event as the system when the window has ended", async () => {
    const t = setup();
    expect(await deemAccepted(t.deps, ORDER)).toEqual({ outcome: "accepted" });
    expect(t.dispatch).toHaveBeenCalledWith(ORDER, { type: "REPORT_DEEMED_ACCEPTED" });
  });

  it("does not send it before the window has ended, nor at the very moment it ends", async () => {
    for (const at of [new Date(UNTIL.getTime() - 3_600_000), UNTIL]) {
      const t = setup({ now: at });
      expect(await deemAccepted(t.deps, ORDER)).toMatchObject({ outcome: "too_early" });
      expect(t.dispatch).not.toHaveBeenCalled();
    }
  });

  it("asks pg-boss to come back one second after the window ends, once", async () => {
    const t = setup({ now: UNTIL });
    await deemAccepted(t.deps, ORDER);
    expect(t.jobs.sent).toEqual([
      {
        queue: QUEUE.ordersScheduled,
        data: {
          job: "objection_window",
          orderId: ORDER,
          orderNumber: "NV-2026-0001",
          at: new Date(UNTIL.getTime() + 1000).toISOString(),
        },
        opts: {
          id: jobIdOf(`objection_window:${ORDER}:${UNTIL.getTime() + 1000}`),
          singletonKey: `objection_window:${ORDER}:${UNTIL.getTime() + 1000}`,
          startAfter: new Date(UNTIL.getTime() + 1000),
        },
      },
    ]);
  });

  it("leaves an objection to the owner: the window is over but the objection is open", async () => {
    const t = setup({ dispatch: async () => ({ ok: false, error: "report_objection_open" }) });
    expect(await deemAccepted(t.deps, ORDER)).toEqual({ outcome: "objection_open" });
    expect(t.jobs.sent).toEqual([]);
  });

  it("takes an order that has gone on, or whose report is accepted, as nothing to do", async () => {
    const gone = setup({ order: order({ status: "settled" }) });
    expect(await deemAccepted(gone.deps, ORDER)).toEqual({ outcome: "not_applicable" });
    expect(gone.dispatch).not.toHaveBeenCalled();
    const accepted = setup({ dispatch: async () => ({ ok: false, error: "invalid_transition" }) });
    expect(await deemAccepted(accepted.deps, ORDER)).toEqual({ outcome: "not_applicable" });
  });

  it("takes an order without a window as nothing to do: silence is not acceptance without a term", async () => {
    const t = setup({ order: order({ objectionUntil: null }) });
    expect(await deemAccepted(t.deps, ORDER)).toEqual({ outcome: "not_applicable" });
    expect(t.dispatch).not.toHaveBeenCalled();
  });

  it("takes an order that is not there as nothing to do", async () => {
    const t = setup({ order: null });
    expect(await deemAccepted(t.deps, ORDER)).toEqual({ outcome: "not_applicable" });
  });

  it("fails loudly on an answer that means a mistake of the worker (it is not allowed to send the event)", async () => {
    const t = setup({ dispatch: async () => ({ ok: false, error: "actor_not_allowed" }) });
    await expect(deemAccepted(t.deps, ORDER)).rejects.toThrow(/actor_not_allowed/);
  });
});

describe("sweepDeemed: the sweep every five minutes finds what the scheduled job missed", () => {
  it("handles every candidate and counts the outcomes", async () => {
    const t = setup();
    t.store.deemedCandidates = async () => [ORDER, "o-2", "o-3"];
    const orders = new Map([
      [ORDER, order()],
      ["o-2", order({ id: "o-2", number: "NV-2026-0002" })],
      ["o-3", order({ id: "o-3", number: "NV-2026-0003", status: "settled" })],
    ]);
    t.store.order = async (id) => orders.get(id) ?? null;
    expect(await sweepDeemed(t.deps)).toEqual({
      accepted: 2,
      too_early: 0,
      objection_open: 0,
      not_applicable: 1,
      failed: 0,
    });
  });

  it("goes on after one order fails", async () => {
    const t = setup();
    t.store.deemedCandidates = async () => [ORDER, "o-2"];
    t.store.order = async (id) => order({ id, number: id });
    let calls = 0;
    t.deps.dispatch = async () => {
      calls += 1;
      if (calls === 1) throw new Error("lock timeout");
      return { ok: true, status: "report_sent" };
    };
    expect(await sweepDeemed(t.deps)).toMatchObject({ accepted: 1, failed: 1 });
    expect(t.lines.some((l) => l.level === "error")).toBe(true);
  });
});

describe("expireEstimate: EXPIRE after the quote's valid-until", () => {
  const sent = order({ status: "estimate_sent" });

  it("expires an estimate whose quote has run out", async () => {
    const t = setup({
      order: sent,
      validUntil: new Date("2026-10-12T10:00:00+05:00"),
      now: new Date("2026-10-12T10:00:01+05:00"),
    });
    expect(await expireEstimate(t.deps, ORDER)).toEqual({ outcome: "expired" });
    expect(t.dispatch).toHaveBeenCalledWith(ORDER, { type: "EXPIRE" });
  });

  it("waits while the quote is still valid, and at the very moment it ends, and asks to come back a second later", async () => {
    const validUntil = new Date("2026-10-12T10:00:00+05:00");
    const t = setup({ order: sent, validUntil, now: validUntil });
    expect(await expireEstimate(t.deps, ORDER)).toEqual({ outcome: "too_early" });
    expect(t.dispatch).not.toHaveBeenCalled();
    expect(t.jobs.sent[0]?.opts?.startAfter).toEqual(new Date(validUntil.getTime() + 1000));
    expect(t.jobs.sent[0]?.data).toMatchObject({ job: "estimate_expiry", orderId: ORDER });
  });

  it("does nothing for an estimate that was accepted, revised or expired already", async () => {
    for (const status of ["accepted", "estimate_draft", "estimate_expired"] as const) {
      const t = setup({ order: order({ status }), validUntil: new Date(0) });
      expect(await expireEstimate(t.deps, ORDER)).toEqual({ outcome: "not_applicable" });
      expect(t.dispatch).not.toHaveBeenCalled();
    }
  });

  it("does nothing when the automaton refuses (invalid_transition) and fails on a mistake of the worker", async () => {
    const refused = setup({
      order: sent,
      validUntil: new Date(0),
      dispatch: async () => ({ ok: false, error: "invalid_transition" }),
    });
    expect(await expireEstimate(refused.deps, ORDER)).toEqual({ outcome: "not_applicable" });
    const wrong = setup({
      order: sent,
      validUntil: new Date(0),
      dispatch: async () => ({ ok: false, error: "actor_not_allowed" }),
    });
    await expect(expireEstimate(wrong.deps, ORDER)).rejects.toThrow(/actor_not_allowed/);
  });

  it("does nothing for an order without a quote term", async () => {
    const t = setup({ order: sent, validUntil: null });
    expect(await expireEstimate(t.deps, ORDER)).toEqual({ outcome: "not_applicable" });
  });
});

describe("sweepExpiry", () => {
  it("expires the estimates that have run out and counts them", async () => {
    const t = setup({ order: order({ status: "estimate_sent" }), validUntil: new Date(0) });
    expect(await sweepExpiry(t.deps)).toEqual({ expired: 1, too_early: 0, not_applicable: 0, failed: 0 });
  });
});

describe("remindAccept: the reminder 24 hours after ACCEPT", () => {
  const accepted = (over: Partial<OrderFacts> = {}) => order({ status: "accepted", objectionUntil: null, ...over });

  it("tells the customer what is still missing: both payments", async () => {
    const t = setup({ order: accepted() });
    expect(await remindAccept(t.deps, ORDER)).toEqual({ outcome: "reminded", missing: "both" });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: `order:${ORDER}:accept_reminder`,
        payload: {
          target: "customer",
          templateKey: "order.accept_reminder",
          customerId: "cust-1",
          orderId: ORDER,
          orderNumber: "NV-2026-0001",
          params: { missing: "both" },
        },
      },
    ]);
  });

  it("names only the money that has not come", async () => {
    const fee = setup({ order: accepted({ fundsReceived: true }) });
    expect(await remindAccept(fee.deps, ORDER)).toEqual({ outcome: "reminded", missing: "fee" });
    const funds = setup({ order: accepted({ feePrepaid: true }) });
    expect(await remindAccept(funds.deps, ORDER)).toEqual({ outcome: "reminded", missing: "funds" });
  });

  it("is silent when both payments have come, when the order has gone on, or is gone", async () => {
    for (const o of [
      accepted({ feePrepaid: true, fundsReceived: true }),
      order({ status: "purchasing" }),
      order({ status: "cancelled" }),
      null,
    ]) {
      const t = setup({ order: o });
      expect(await remindAccept(t.deps, ORDER)).toEqual({ outcome: "not_needed" });
      expect(t.enqueued).toEqual([]);
    }
  });
});

describe("failIfSweepFailed: an order that cannot be taken by the sweep is a failure of the job, not only a line of the log", () => {
  it("does nothing when no order failed", () => {
    expect(() => failIfSweepFailed("orders.reminders", { failed: 0 })).not.toThrow();
  });

  it("throws a text with the number of orders, and no order data, when some failed", () => {
    expect(() => failIfSweepFailed("orders.reminders", { failed: 2 })).toThrow(
      "orders.reminders: 2 orders could not be processed (see the log of the worker)",
    );
  });
});
