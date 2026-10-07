import { ops } from "@nivel/db/repos";
import { createWorkCalendar, isoDateInTashkent } from "@nivel/domain/calendar";
import { leads, reports } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptedOrder,
  customerActor,
  ownerActor,
  reportSentOrder,
  sentOrder,
} from "../../queues/test-support/flow.ts";
import { testRuntime } from "../../queues/test-support/runtime.ts";
import { createWorld, type World } from "../../queues/test-support/world.ts";
import { QUEUE } from "../outbox/routes.ts";
import { scheduledDepsOf } from "./register.ts";
import { sweepLeadReminders } from "./reminders.ts";
import { handleScheduled } from "./scheduled.ts";
import { sweepDeemed, sweepExpiry } from "./terms.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<T>(sql, params).then((r) => r.rows);

const events = (orderId: string) =>
  q<{ type: string; actor_kind: string }>(
    "select event->>'type' as type, actor_kind from sales.order_events where order_id = $1 order by seq",
    [orderId],
  );
const outboxOf = (key: string) =>
  q<{ payload: Record<string, unknown> }>("select payload from ops.outbox where dedupe_key = $1", [key]);

describe("REPORT_DEEMED_ACCEPTED on the real automaton, as the system", () => {
  it("says nothing before the window ends, nor at the very moment, and accepts the report the second after", async () => {
    const o = await reportSentOrder(w);
    const [row] = await q<{ objection_until: Date }>("select objection_until from sales.orders where id = $1", [
      o.orderId,
    ]);
    const until = row?.objection_until as Date;
    const t = testRuntime(w);
    const deps = scheduledDepsOf(t.rt);

    w.clock.set(new Date(until.getTime() - 3_600_000));
    expect(await sweepDeemed(deps)).toMatchObject({ accepted: 0 });
    w.clock.set(until);
    expect(await sweepDeemed(deps)).toMatchObject({ accepted: 0 });
    // the job that fires at the very moment is told to come back a second later
    await handleScheduled(deps, { job: "objection_window", orderId: o.orderId });
    expect(t.jobs.sent).toHaveLength(1);
    expect(t.jobs.sent[0]?.queue).toBe(QUEUE.ordersScheduled);
    expect(t.jobs.sent[0]?.opts?.startAfter).toEqual(new Date(until.getTime() + 1000));
    expect((await events(o.orderId)).map((e) => e.type)).not.toContain("REPORT_DEEMED_ACCEPTED");

    w.clock.set(new Date(until.getTime() + 1000));
    expect(await sweepDeemed(deps)).toMatchObject({ accepted: 1 });
    const journal = await events(o.orderId);
    expect(journal.at(-1)).toEqual({ type: "REPORT_DEEMED_ACCEPTED", actor_kind: "system" });
    const [status] = await q("select status from sales.orders where id = $1", [o.orderId]);
    expect(status?.status).toBe("report_sent");
  });

  it("does it once: the next sweep and a repeated job find nothing to do", async () => {
    const o = await reportSentOrder(w);
    const [row] = await q<{ objection_until: Date }>("select objection_until from sales.orders where id = $1", [
      o.orderId,
    ]);
    const until = row?.objection_until as Date;
    const deps = scheduledDepsOf(testRuntime(w).rt);
    w.clock.set(new Date(until.getTime() + 60_000));
    await handleScheduled(deps, { job: "objection_window", orderId: o.orderId });
    expect(await sweepDeemed(deps)).toEqual({
      accepted: 0,
      too_early: 0,
      objection_open: 0,
      not_applicable: 0,
      failed: 0,
    });
    await handleScheduled(deps, { job: "objection_window", orderId: o.orderId });
    const accepted = (await events(o.orderId)).filter((e) => e.type === "REPORT_DEEMED_ACCEPTED");
    expect(accepted).toHaveLength(1);
  });

  it("leaves an open objection to the owner, and takes the report once the owner has answered", async () => {
    const o = await reportSentOrder(w);
    const [row] = await q<{ objection_until: Date }>("select objection_until from sales.orders where id = $1", [
      o.orderId,
    ]);
    const until = row?.objection_until as Date;
    w.clock.set(new Date(until.getTime() - 3_600_000));
    const objected = await reports.object({ orderId: o.orderId, text: "Savol bor" }, customerActor(o), w.bot);
    expect(objected.ok).toBe(true);
    const deps = scheduledDepsOf(testRuntime(w).rt);
    w.clock.set(new Date(until.getTime() + 60_000));
    expect(await sweepDeemed(deps)).toMatchObject({ accepted: 0, objection_open: 1 });
    await reports.resolveObjection({ orderId: o.orderId, note: "Javob berildi" }, ownerActor(w), w.admin);
    expect(await sweepDeemed(deps)).toMatchObject({ accepted: 1 });
  });

  it("does not touch a report the customer has accepted himself", async () => {
    const o = await reportSentOrder(w);
    const [row] = await q<{ objection_until: Date }>("select objection_until from sales.orders where id = $1", [
      o.orderId,
    ]);
    const accepted = await reports.accept({ orderId: o.orderId }, customerActor(o), w.bot);
    expect(accepted.ok).toBe(true);
    w.clock.set(new Date((row?.objection_until as Date).getTime() + 3_600_000));
    const deps = scheduledDepsOf(testRuntime(w).rt);
    expect(await sweepDeemed(deps)).toEqual({
      accepted: 0,
      too_early: 0,
      objection_open: 0,
      not_applicable: 0,
      failed: 0,
    });
    expect((await events(o.orderId)).filter((e) => e.type === "REPORT_DEEMED_ACCEPTED")).toHaveLength(0);
  });
});

describe("EXPIRE of an estimate on the real automaton", () => {
  it("waits for valid-until, and expires the estimate after it, with a message to the customer", async () => {
    const o = await sentOrder(w);
    const [row] = await q<{ valid_until: Date }>(
      "select qt.valid_until from sales.orders od join sales.quotes qt on qt.id = od.current_quote_id where od.id = $1",
      [o.orderId],
    );
    const validUntil = row?.valid_until as Date;
    const deps = scheduledDepsOf(testRuntime(w).rt);

    w.clock.set(new Date(validUntil.getTime() - 60_000));
    expect(await sweepExpiry(deps)).toMatchObject({ expired: 0 });
    w.clock.set(new Date(validUntil.getTime() + 1000));
    expect(await sweepExpiry(deps)).toMatchObject({ expired: 1 });
    const [status] = await q("select status from sales.orders where id = $1", [o.orderId]);
    expect(status?.status).toBe("estimate_expired");
    expect((await events(o.orderId)).at(-1)).toEqual({ type: "EXPIRE", actor_kind: "system" });
    const messages = await q<{ payload: { templateKey: string; target: string } }>(
      "select payload from ops.outbox where payload->>'orderId' = $1 and payload->>'templateKey' = 'order.estimate_expired'",
      [o.orderId],
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload.target).toBe("customer");
    expect(await sweepExpiry(deps)).toMatchObject({ expired: 0 });
  });

  it("the job of the calendar, fired at the very end of the term, comes back a second later", async () => {
    const o = await sentOrder(w);
    const [row] = await q<{ valid_until: Date }>(
      "select qt.valid_until from sales.orders od join sales.quotes qt on qt.id = od.current_quote_id where od.id = $1",
      [o.orderId],
    );
    const validUntil = row?.valid_until as Date;
    const t = testRuntime(w);
    w.clock.set(validUntil);
    await handleScheduled(scheduledDepsOf(t.rt), { job: "estimate_expiry", orderId: o.orderId });
    expect(t.jobs.sent[0]?.opts?.startAfter).toEqual(new Date(validUntil.getTime() + 1000));
    const [status] = await q("select status from sales.orders where id = $1", [o.orderId]);
    expect(status?.status).toBe("estimate_sent");
  });
});

describe("the reminder 24 hours after ACCEPT, with the real outbox row of the automaton", () => {
  it("tells the customer who has not paid, once, with the order and the customer from the database", async () => {
    const o = await acceptedOrder(w);
    const [queued] = await q<{ payload: Record<string, unknown>; send_after: Date }>(
      "select payload, send_after from ops.outbox where payload->>'job' = 'accept_reminder' and payload->>'orderId' = $1",
      [o.orderId],
    );
    expect(queued).toBeDefined();
    const deps = scheduledDepsOf(testRuntime(w).rt);
    await handleScheduled(deps, queued?.payload as Record<string, unknown>);
    await handleScheduled(deps, queued?.payload as Record<string, unknown>);
    const sent = await outboxOf(`order:${o.orderId}:accept_reminder`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      target: "customer",
      templateKey: "order.accept_reminder",
      customerId: o.customerId,
      orderNumber: o.number,
      params: { missing: "both" },
    });
  });

  it("is silent once the order has gone on: the customer has paid and the purchases began", async () => {
    const o = await reportSentOrder(w);
    const deps = scheduledDepsOf(testRuntime(w).rt);
    await handleScheduled(deps, { job: "accept_reminder", orderId: o.orderId });
    expect(await outboxOf(`order:${o.orderId}:accept_reminder`)).toEqual([]);
  });
});

describe("the requests nobody has answered", () => {
  it("finds a request, tells the owner once in the topic of the request, and leaves a request that was answered", async () => {
    const answered = await leads.create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: 7_700_000_001 } },
      w.bot,
    );
    const waiting = await leads.create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: 7_700_000_002 } },
      w.bot,
    );
    await q("update sales.leads set first_response_at = now() where id = $1", [answered.leadId]);

    // The hours of answers: Monday to Saturday 10:00-19:00. Take the first such half hour after the request was made.
    const [made] = await q<{ created_at: Date }>("select created_at from sales.leads where id = $1", [waiting.leadId]);
    const cal = createWorkCalendar([], { from: "10:00", to: "19:00" });
    let now = new Date((made?.created_at as Date).getTime() + 20 * 60_000);
    while (!cal.isResponseHours(now)) now = new Date(now.getTime() + 30 * 60_000);
    w.clock.set(now);

    const deps = scheduledDepsOf(testRuntime(w).rt);
    const first = await sweepLeadReminders(deps);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    const sent = await outboxOf(`lead:${waiting.leadId}:no_answer_15m`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      target: "owner_topic",
      templateKey: "reminder.lead_no_answer",
      leadId: waiting.leadId,
    });
    expect(await outboxOf(`lead:${answered.leadId}:no_answer_15m`)).toEqual([]);
    // the second sweep does not ask again for a request that has a reminder
    const second = await sweepLeadReminders(deps);
    expect(second.reminded).toBe(0);
    expect(await outboxOf(`lead:${waiting.leadId}:no_answer_15m`)).toHaveLength(1);
  });

  it("does not remind on Sunday: the sweep closes, and the request waits for Monday", async () => {
    const lead = await leads.create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: 7_700_000_003 } },
      w.bot,
    );
    w.clock.set(new Date("2026-10-18T12:00:00+05:00")); // a Sunday, later than any request of this test
    const deps = scheduledDepsOf(testRuntime(w).rt);
    const result = await sweepLeadReminders(deps);
    expect(result.reminded).toBe(0);
    expect(await outboxOf(`lead:${lead.leadId}:no_answer_15m`)).toEqual([]);
  });

  it("honours the holidays of the owner's calendar in ops.settings: a holiday is a day off for the reminders", async () => {
    const lead = await leads.create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: 7_700_000_004 } },
      w.bot,
    );
    const [made] = await q<{ created_at: Date }>("select created_at from sales.leads where id = $1", [lead.leadId]);
    const plain = createWorkCalendar([], { from: "10:00", to: "19:00" });
    let first = new Date((made?.created_at as Date).getTime() + 20 * 60_000);
    while (!plain.isResponseHours(first)) first = new Date(first.getTime() + 30 * 60_000);
    const holiday = isoDateInTashkent(first);
    await ops.setSetting(
      w.db,
      "calendar.work",
      { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [holiday] },
      "test",
    );
    const deps = scheduledDepsOf(testRuntime(w).rt);
    w.clock.set(first); // inside the usual hours, but the owner has made this day a holiday
    expect((await sweepLeadReminders(deps)).reminded).toBe(0);
    const withHoliday = createWorkCalendar([holiday], { from: "10:00", to: "19:00" });
    let next = new Date(first.getTime() + 30 * 60_000);
    while (!withHoliday.isResponseHours(next)) next = new Date(next.getTime() + 30 * 60_000);
    w.clock.set(next);
    expect((await sweepLeadReminders(deps)).reminded).toBeGreaterThanOrEqual(1);
    expect(await outboxOf(`lead:${lead.leadId}:no_answer_15m`)).toHaveLength(1);
  });
});
