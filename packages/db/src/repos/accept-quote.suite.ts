import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, insertOfferStub, one, orderState, pgError, sendQuote, transition } from "./testkit.ts";

// WP-00 (b): ACCEPT by the customer through the bot or the site moves the current quote of the order to `accepted` in
// the same transaction (only the admin role may UPDATE sales.quotes, so nobody else could do it afterwards).
let migrator: pg.Client;
const clients = {} as Record<"WEB" | "BOT" | "ADMIN", pg.Client>;
let offers: { uz: string; ru: string };

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  for (const role of ["WEB", "BOT", "ADMIN"] as const) clients[role] = await connectAs(role);
  offers = { uz: await insertOfferStub(migrator, "uz"), ru: await insertOfferStub(migrator, "ru") };
});
afterAll(async () => {
  for (const c of [migrator, ...Object.values(clients)]) await c.end();
});

const ACCEPTED_AT = "2026-10-12T05:00:00.000Z";

/** An order whose estimate was sent: the quote is `sent`, the order is `estimate_sent`. */
async function sentOrder() {
  const o = await createOrder(migrator);
  await sendQuote(migrator, o.quoteId);
  await transition(migrator, o.orderId, "SEND_ESTIMATE");
  return o;
}

function accept(
  c: pg.Client,
  o: { orderId: string; customerId: string },
  event: Record<string, unknown> = {},
  changes: Record<string, unknown> = {
    accepted_at: ACCEPTED_AT,
    offer_version_uz_id: offers.uz,
    offer_version_ru_id: offers.ru,
  },
) {
  return c.query(
    "select * from sales.apply_transition($1, $2::jsonb, 'customer', $3, 'estimate_sent', null, $4::jsonb)",
    [o.orderId, JSON.stringify({ type: "ACCEPT", ...event }), o.customerId, JSON.stringify(changes)],
  );
}

const quoteOf = (id: string) =>
  one<{ status: string; accepted_at: Date | null; acceptance: Record<string, unknown> | null }>(
    migrator,
    "select status, accepted_at, acceptance from sales.quotes where id = $1",
    [id],
  );

describe.each(["WEB", "BOT", "ADMIN"] as const)("ACCEPT through apply_transition as %s", (role) => {
  it("moves the order and the current quote together, with the time and the acceptance of the event", async () => {
    const o = await sentOrder();
    const consentIds = ["c1", "c2"];
    const r = await accept(clients[role], o, {
      quoteId: o.quoteId,
      channel: role === "WEB" ? "site" : "bot",
      consentIds,
    });
    expect(r.rows[0]).toMatchObject({ out_from: "estimate_sent", out_to: "accepted" });
    const q = await quoteOf(o.quoteId);
    expect(q.status).toBe("accepted");
    expect(q.accepted_at?.toISOString()).toBe(ACCEPTED_AT);
    expect(q.acceptance).toEqual({
      channel: role === "WEB" ? "site" : "bot",
      consentIds,
      offerVersionUzId: offers.uz,
      offerVersionRuId: offers.ru,
      actorId: o.customerId,
      dbRole: `nivel_${role.toLowerCase()}`,
    });
    expect((await orderState(migrator, o.orderId)).status).toBe("accepted");
  });

  it("is one step with the status: a refusal of the function leaves the quote sent", async () => {
    const o = await sentOrder();
    // The customer may not write a money field with ACCEPT: the call fails, the quote must not be touched.
    const e = await pgError(
      clients[role],
      "select * from sales.apply_transition($1, '{\"type\":\"ACCEPT\"}'::jsonb, 'customer', $2, null, null, '{\"funds_received\":true}'::jsonb)",
      [o.orderId, o.customerId],
    );
    expect(e.message).toMatch(/^change_not_allowed:/);
    expect((await quoteOf(o.quoteId)).status).toBe("sent");
    expect((await orderState(migrator, o.orderId)).status).toBe("estimate_sent");
  });

  it("rolls back with the caller's transaction: nothing of the quote stays", async () => {
    const o = await sentOrder();
    await clients[role].query("begin");
    try {
      await accept(clients[role], o, { quoteId: o.quoteId, channel: "bot" });
      const inside = await clients[role].query("select status from sales.v_customer_order_status where order_id = $1", [
        o.orderId,
      ]);
      expect(inside.rows).toEqual([{ status: "accepted" }]);
    } finally {
      await clients[role].query("rollback");
    }
    expect((await quoteOf(o.quoteId)).status).toBe("sent");
    expect((await orderState(migrator, o.orderId)).status).toBe("estimate_sent");
  });
});

describe("the quote that is accepted", () => {
  it("is the current quote of the order named by the event, never another one", async () => {
    const o = await sentOrder();
    const other = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const e = await pgError(
      clients.BOT,
      "select * from sales.apply_transition($1, $2::jsonb, 'customer', $3, null, null, '{}'::jsonb)",
      [o.orderId, JSON.stringify({ type: "ACCEPT", quoteId: other }), o.customerId],
    );
    expect(e.message).toMatch(/^invalid_transition:/);
    expect((await quoteOf(o.quoteId)).status).toBe("sent");
    expect((await orderState(migrator, o.orderId)).status).toBe("estimate_sent");
  });

  it("leaves an older, superseded quote of the order as it was", async () => {
    const o = await createOrder(migrator);
    await sendQuote(migrator, o.quoteId);
    await migrator.query("update sales.quotes set status = 'superseded' where id = $1", [o.quoteId]);
    const second = await one<{ id: string }>(
      migrator,
      `insert into sales.quotes (order_id, version, status, totals, components_sum, reserve_bp, reserve_sum, purchase_limit,
          fee_total, fee_commission_line, fee_works_line, fee_advance, fee_final, outside_scale_sum, settings_version)
       select order_id, 2, 'draft', totals, components_sum, reserve_bp, reserve_sum, purchase_limit, fee_total,
              fee_commission_line, fee_works_line, fee_advance, fee_final, outside_scale_sum, settings_version
         from sales.quotes where id = $1 returning id`,
      [o.quoteId],
    );
    await migrator.query("update sales.orders set current_quote_id = $1 where id = $2", [second.id, o.orderId]);
    await sendQuote(migrator, second.id);
    await transition(migrator, o.orderId, "SEND_ESTIMATE");
    await accept(clients.WEB, o, { quoteId: second.id, channel: "site" });
    expect((await quoteOf(second.id)).status).toBe("accepted");
    expect((await quoteOf(o.quoteId)).status).toBe("superseded");
  });

  it("is touched only by ACCEPT: the later events of the order do not write the quote again", async () => {
    const o = await sentOrder();
    await accept(clients.BOT, o, { quoteId: o.quoteId, channel: "bot" });
    const before = await quoteOf(o.quoteId);
    await transition(migrator, o.orderId, "MEETING_DONE");
    expect(await quoteOf(o.quoteId)).toEqual(before);
  });

  it("an estimate that was never marked sent is not turned into an accepted one behind the owner's check", async () => {
    // The orders of the older tests are driven by events alone; the quote stays a draft and ACCEPT does not touch it.
    const o = await createOrder(migrator);
    await transition(migrator, o.orderId, "SEND_ESTIMATE");
    await accept(clients.BOT, o, { channel: "bot" });
    expect((await quoteOf(o.quoteId)).status).toBe("draft");
    expect((await orderState(migrator, o.orderId)).status).toBe("accepted");
  });

  it("keeps the acceptance of the first customer: the quote cannot be accepted twice", async () => {
    const o = await sentOrder();
    await accept(clients.WEB, o, { quoteId: o.quoteId, channel: "site" });
    const e = await pgError(
      clients.BOT,
      "select * from sales.apply_transition($1, '{\"type\":\"ACCEPT\"}'::jsonb, 'customer', $2, null, null, '{}'::jsonb)",
      [o.orderId, o.customerId],
    );
    expect(e.message).toMatch(/^invalid_transition:/);
    expect((await quoteOf(o.quoteId)).acceptance).toMatchObject({ channel: "site" });
  });
});
