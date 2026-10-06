import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, driveTo, ORDER_PATH, one, pgError, transition } from "./testkit.ts";

// ARCHITECTURE 4.9, 4.13: the status changes only through sales.apply_transition(); every step is journaled.
let migrator: pg.Client;
let admin: pg.Client;
let web: pg.Client;
let worker: pg.Client;

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
  web = await connectAs("WEB");
  worker = await connectAs("WORKER");
});
afterAll(async () => {
  for (const c of [migrator, admin, web, worker]) await c.end();
});

describe("order status is changed only by apply_transition", () => {
  it("starts an order as estimate_draft and nothing else", async () => {
    const { customerId } = await createOrder(migrator);
    const e = await pgError(
      migrator,
      "insert into sales.orders (number, customer_id, kind, status) values ('NV-2026-9001', $1, 'pc', 'accepted')",
      [customerId],
    );
    expect(e.message).toMatch(/invalid_initial_status/);
  });

  it.each([["MIGRATOR"], ["ADMIN"]] as const)("rejects a direct UPDATE of the status by %s", async (role) => {
    const { orderId } = await createOrder(migrator);
    const client = role === "ADMIN" ? admin : migrator;
    const e = await pgError(client, "update sales.orders set status = 'accepted' where id = $1", [orderId]);
    expect(e.message).toMatch(/direct_status_change/);
    const row = await one<{ status: string }>(migrator, "select status from sales.orders where id = $1", [orderId]);
    expect(row.status).toBe("estimate_draft");
  });

  it("rejects a direct UPDATE even when the caller sets the transition flag itself", async () => {
    const { orderId } = await createOrder(migrator);
    await admin.query("select set_config('nivel.apply_transition', 'on', false)");
    try {
      const e = await pgError(admin, "update sales.orders set status = 'closed' where id = $1", [orderId]);
      expect(e.message).toMatch(/direct_status_change/);
    } finally {
      await admin.query("select set_config('nivel.apply_transition', 'off', false)");
    }
  });

  it("still allows changing other order fields directly", async () => {
    const { orderId } = await createOrder(migrator);
    await admin.query("update sales.orders set tg_topic_id = 77, complex_build = true where id = $1", [orderId]);
    const row = await one<{ tg_topic_id: string; complex_build: boolean }>(
      migrator,
      "select tg_topic_id::text, complex_build from sales.orders where id = $1",
      [orderId],
    );
    expect(row).toEqual({ tg_topic_id: "77", complex_build: true });
  });

  it("walks the whole regular path to closed, journaling every step with consecutive numbers", async () => {
    const { orderId } = await createOrder(migrator);
    const seen: string[] = [];
    let n = 0;
    for (const [event, to] of ORDER_PATH) {
      const r = await transition(admin, orderId, event);
      n += 1;
      expect(r.to, event).toBe(to);
      expect(r.seq).toBe(n);
      seen.push(event);
    }
    const events = await migrator.query<{
      seq: number;
      event: { type: string };
      from_status: string;
      to_status: string;
    }>("select seq, event, from_status, to_status from sales.order_events where order_id = $1 order by seq", [orderId]);
    expect(events.rows.map((r) => r.event.type)).toEqual(seen);
    expect(events.rows[0]).toMatchObject({ from_status: "estimate_draft", to_status: "estimate_sent" });
    expect(events.rows.at(-1)).toMatchObject({ from_status: "handed_over", to_status: "closed" });
    const audit = await migrator.query("select action from ops.audit_log where entity_id = $1", [orderId]);
    expect(audit.rowCount).toBe(ORDER_PATH.length);
    expect(audit.rows.map((r) => r.action)).toContain("order.HANDOVER");
    const status = await one<{ status: string }>(migrator, "select status from sales.orders where id = $1", [orderId]);
    expect(status.status).toBe("closed");
  });

  it("writes the order fields given in changes and refuses unknown ones", async () => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, "accepted");
    await transition(admin, orderId, "FUNDS_RECEIVED", {
      changes: {
        funds_received: true,
        funds_received_at: "2026-10-06T08:00:00Z",
        purchase_not_before: "2026-10-07T05:00:00Z",
      },
    });
    const row = await one<{ funds_received: boolean; purchase_not_before: Date; fee_prepaid: boolean }>(
      migrator,
      "select funds_received, purchase_not_before, fee_prepaid from sales.orders where id = $1",
      [orderId],
    );
    expect(row.funds_received).toBe(true);
    expect(row.purchase_not_before.toISOString()).toBe("2026-10-07T05:00:00.000Z");
    expect(row.fee_prepaid).toBe(false); // fields that are not in `changes` keep their value
    const e = await pgError(
      admin,
      "select * from sales.apply_transition($1, '{\"type\":\"MEETING_DONE\"}', 'owner', 'x', null, null, '{\"status\":\"closed\"}')",
      [orderId],
    );
    expect(e.message).toMatch(/unknown_change/);
  });
});

describe("the status graph", () => {
  const INVALID: [from: string, event: string][] = [
    ["estimate_draft", "ACCEPT"],
    ["estimate_draft", "START_PURCHASE"],
    ["estimate_sent", "CLOSE"],
    ["accepted", "PURCHASE_DONE"],
    ["purchasing", "SEND_REPORT"],
    ["report_sent", "MATERIALS_ACCEPTED"],
    ["settled", "TESTS_PASSED"],
    ["ready", "HANDOVER"],
    ["delivering", "CLOSE"],
    ["handed_over", "CANCEL"],
    ["closed", "CANCEL"],
    ["estimate_draft", "CANCEL_SETTLED"],
    ["estimate_draft", "NO_SUCH_EVENT"],
  ];
  it.each(INVALID)("refuses %s + %s", async (from, event) => {
    const { orderId } = await createOrder(migrator);
    if (from !== "estimate_draft") await driveTo(admin, orderId, from);
    const e = await pgError(admin, "select * from sales.apply_transition($1, $2::jsonb, 'owner', 'x')", [
      orderId,
      JSON.stringify({ type: event }),
    ]);
    expect(e.message).toMatch(/invalid_transition/);
  });

  const BEFORE_HANDOVER = ORDER_PATH.map(([, to]) => to).filter(
    (s, i, all) => all.indexOf(s) === i && !["handed_over", "closed"].includes(s),
  );
  it.each(["estimate_draft", ...BEFORE_HANDOVER])("lets the owner cancel from %s", async (from) => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, from);
    const r = await transition(admin, orderId, "CANCEL");
    expect(r.to).toBe("cancelling");
  });

  it("cancels from estimate_expired and revises an expired or sent estimate", async () => {
    const a = await createOrder(migrator);
    await transition(admin, a.orderId, "SEND_ESTIMATE");
    expect((await transition(worker, a.orderId, "EXPIRE")).to).toBe("estimate_expired");
    expect((await transition(admin, a.orderId, "REVISE")).to).toBe("estimate_draft");
    await transition(admin, a.orderId, "SEND_ESTIMATE");
    expect((await transition(admin, a.orderId, "REVISE")).to).toBe("estimate_draft");
    await transition(admin, a.orderId, "SEND_ESTIMATE");
    await transition(worker, a.orderId, "EXPIRE");
    expect((await transition(admin, a.orderId, "CANCEL")).to).toBe("cancelling");
    expect((await transition(admin, a.orderId, "CANCEL_SETTLED")).to).toBe("cancelled");
  });

  it("delivers a podbor order from a sent estimate", async () => {
    const { orderId } = await createOrder(migrator);
    await transition(admin, orderId, "SEND_ESTIMATE");
    expect((await transition(admin, orderId, "PODBOR_DELIVERED")).to).toBe("podbor_delivered");
  });
});

describe("who may call", () => {
  const MONEY_EVENTS = [
    "FEE_PREPAID",
    "FUNDS_RECEIVED",
    "START_PURCHASE",
    "REMAINDER_SETTLED",
    "HANDOVER",
    "CANCEL",
    "CANCEL_SETTLED",
    "SEND_ESTIMATE",
  ];
  it.each(MONEY_EVENTS)("gives the assistant actor_not_allowed on %s", async (event) => {
    const { orderId } = await createOrder(migrator);
    const e = await pgError(admin, "select * from sales.apply_transition($1, $2::jsonb, 'assistant', 'helper')", [
      orderId,
      JSON.stringify({ type: event }),
    ]);
    expect(e.message).toMatch(/actor_not_allowed/);
    expect(e.code).toBe("42501");
  });

  it("lets the assistant record purchases and assembly steps", async () => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, "purchasing");
    const r = await transition(admin, orderId, "PURCHASE_RECORDED", { actorKind: "assistant", actorId: "helper" });
    expect(r.to).toBe("purchasing");
  });

  it("lets the public site act only as the customer", async () => {
    const { orderId } = await createOrder(migrator);
    await transition(admin, orderId, "SEND_ESTIMATE");
    const e = await pgError(web, "select * from sales.apply_transition($1, '{\"type\":\"ACCEPT\"}', 'owner', 'x')", [
      orderId,
    ]);
    expect(e.message).toMatch(/actor_not_allowed/);
    const r = await transition(web, orderId, "ACCEPT");
    expect(r.to).toBe("accepted");
  });

  it("lets the worker act only as the system", async () => {
    const { orderId } = await createOrder(migrator);
    await transition(admin, orderId, "SEND_ESTIMATE");
    const e = await pgError(worker, "select * from sales.apply_transition($1, '{\"type\":\"EXPIRE\"}', 'owner', 'x')", [
      orderId,
    ]);
    expect(e.message).toMatch(/actor_not_allowed/);
  });

  it("rejects an unknown actor kind and an event without a type", async () => {
    const { orderId } = await createOrder(migrator);
    const a = await pgError(
      admin,
      "select * from sales.apply_transition($1, '{\"type\":\"SEND_ESTIMATE\"}', 'robot', 'x')",
      [orderId],
    );
    expect(a.message).toMatch(/invalid_actor/);
    const b = await pgError(admin, "select * from sales.apply_transition($1, '{}', 'owner', 'x')", [orderId]);
    expect(b.message).toMatch(/invalid_event/);
  });
});

describe("concurrency and lost updates", () => {
  it("refuses a stale expected status (serialization failure, the caller retries)", async () => {
    const { orderId } = await createOrder(migrator);
    await transition(admin, orderId, "SEND_ESTIMATE");
    const e = await pgError(
      admin,
      "select * from sales.apply_transition($1, '{\"type\":\"ACCEPT\"}', 'customer', 'x', 'estimate_draft')",
      [orderId],
    );
    expect(e.code).toBe("40001");
  });

  it("reports an unknown order", async () => {
    const e = await pgError(
      admin,
      "select * from sales.apply_transition('00000000-0000-7000-8000-000000000000', '{\"type\":\"SEND_ESTIMATE\"}', 'owner', 'x')",
    );
    expect(e.message).toMatch(/order_not_found/);
  });

  it("serialises two simultaneous transitions of one order: exactly one wins", async () => {
    const { orderId } = await createOrder(migrator);
    await transition(admin, orderId, "SEND_ESTIMATE");
    const other = await connectAs("ADMIN");
    try {
      const results = await Promise.allSettled([
        transition(admin, orderId, "ACCEPT", { expectedFrom: "estimate_sent", actorKind: "customer" }),
        transition(other, orderId, "ACCEPT", { expectedFrom: "estimate_sent", actorKind: "customer" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const events = await one<{ n: string }>(
        migrator,
        "select count(*)::text as n from sales.order_events where order_id = $1 and to_status = 'accepted'",
        [orderId],
      );
      expect(events.n).toBe("1");
    } finally {
      await other.end();
    }
  });
});

describe("the graph is data the application roles cannot edit", () => {
  it("refuses INSERT and DELETE on sales.order_transitions for admin", async () => {
    expect(
      (await pgError(admin, "insert into sales.order_transitions values ('closed', 'REOPEN', 'accepted')")).code,
    ).toBe("42501");
    expect((await pgError(admin, "delete from sales.order_transitions")).code).toBe("42501");
  });
});
