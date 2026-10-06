import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, insertPayment, one, pgError, uniq } from "./testkit.ts";

// ARCHITECTURE 3.1: journals only append; a correction is a reversing row (WP-06: "UPDATE of a journal is an error").
let migrator: pg.Client;
let admin: pg.Client;

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
});
afterAll(async () => {
  await migrator.end();
  await admin.end();
});

const APPEND_ONLY = /append_only/;

describe("ops.audit_log", () => {
  it("accepts rows but never UPDATE, DELETE or TRUNCATE", async () => {
    const row = await one<{ id: string }>(
      admin,
      "insert into ops.audit_log (actor, action, entity) values ('test', 'x', 'y') returning id",
    );
    expect((await pgError(migrator, "update ops.audit_log set action = 'z' where id = $1", [row.id])).message).toMatch(
      APPEND_ONLY,
    );
    expect((await pgError(migrator, "delete from ops.audit_log where id = $1", [row.id])).message).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "truncate ops.audit_log")).message).toMatch(APPEND_ONLY);
  });

  it("is closed to the admin role even before the trigger (no UPDATE or DELETE right)", async () => {
    const e1 = await pgError(admin, "update ops.audit_log set action = 'z'");
    const e2 = await pgError(admin, "delete from ops.audit_log");
    expect(e1.code).toBe("42501");
    expect(e2.code).toBe("42501");
  });
});

describe("ops.consents", () => {
  it("is append-only; withdrawal is a new row", async () => {
    const { customerId } = await createOrder(migrator);
    const row = await one<{ id: string }>(
      migrator,
      "insert into ops.consents (customer_id, kind, granted) values ($1, 'marketing', true) returning id",
      [customerId],
    );
    expect(
      (await pgError(migrator, "update ops.consents set granted = false where id = $1", [row.id])).message,
    ).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "delete from ops.consents where id = $1", [row.id])).message).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "truncate ops.consents cascade")).message).toMatch(APPEND_ONLY);
    await migrator.query("insert into ops.consents (customer_id, kind, granted) values ($1, 'marketing', false)", [
      customerId,
    ]);
    const { rows } = await migrator.query("select granted from ops.consents where customer_id = $1 order by at, id", [
      customerId,
    ]);
    expect(rows.map((r) => r.granted)).toEqual([true, false]);
  });

  it("needs a customer or a subject hash, and an order for order-level consents", async () => {
    expect(
      (await pgError(migrator, "insert into ops.consents (kind, granted) values ('marketing', true)")).message,
    ).toMatch(/consents_subject_chk/);
    const { customerId } = await createOrder(migrator);
    expect(
      (
        await pgError(
          migrator,
          "insert into ops.consents (customer_id, kind, granted) values ($1, 'limit_overrun', true)",
          [customerId],
        )
      ).message,
    ).toMatch(/consents_order_scope_chk/);
  });
});

describe("sales.order_events and sales.reserve_ledger", () => {
  it("refuse UPDATE and DELETE", async () => {
    const { orderId } = await createOrder(migrator);
    await migrator.query(
      `insert into sales.order_events (order_id, seq, actor_kind, actor_id, event, from_status, to_status)
       values ($1, 1, 'owner', 'x', '{"type":"SEND_ESTIMATE"}', 'estimate_draft', 'estimate_sent')`,
      [orderId],
    );
    expect(
      (await pgError(migrator, "update sales.order_events set actor_id = 'y' where order_id = $1", [orderId])).message,
    ).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "delete from sales.order_events where order_id = $1", [orderId])).message).toMatch(
      APPEND_ONLY,
    );
    expect((await pgError(migrator, "truncate sales.order_events")).message).toMatch(APPEND_ONLY);
    const ledger = await one<{ id: string }>(
      migrator,
      "insert into sales.reserve_ledger (fund, order_id, amount_sum, reason) values ('warranty', $1, 150000, 'contribution') returning id",
      [orderId],
    );
    expect(
      (await pgError(migrator, "update sales.reserve_ledger set amount_sum = 1 where id = $1", [ledger.id])).message,
    ).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "delete from sales.reserve_ledger where id = $1", [ledger.id])).message).toMatch(
      APPEND_ONLY,
    );
    expect((await pgError(migrator, "truncate sales.reserve_ledger")).message).toMatch(APPEND_ONLY);
  });

  it("takes a reversing row instead of a change and refuses a zero amount", async () => {
    await migrator.query(
      "insert into sales.reserve_ledger (fund, amount_sum, reason) values ('tax_risk', 100000, 'in')",
    );
    await migrator.query(
      "insert into sales.reserve_ledger (fund, amount_sum, reason) values ('tax_risk', -100000, 'reversal')",
    );
    expect(
      (
        await pgError(
          migrator,
          "insert into sales.reserve_ledger (fund, amount_sum, reason) values ('tax_risk', 0, 'x')",
        )
      ).message,
    ).toMatch(/reserve_ledger_amount_chk/);
  });
});

describe("pricing.price_observations", () => {
  async function observation(): Promise<string> {
    const n = uniq();
    const v = await one<{ id: string }>(
      migrator,
      "insert into pricing.vendors (name, kind, price_source) values ($1, 'shop', 'manual') returning id",
      [`Obs vendor ${n}`],
    );
    const o = await one<{ id: string }>(
      migrator,
      `insert into pricing.price_observations (vendor_id, price_sum, availability, source)
       values ($1, 1500000, 'in_stock', 'manual') returning id`,
      [v.id],
    );
    return o.id;
  }

  it("changes only the excluded flag with a reason", async () => {
    const id = await observation();
    await migrator.query(
      "update pricing.price_observations set excluded = true, exclude_reason = 'outlier' where id = $1",
      [id],
    );
    const row = await one<{ excluded: boolean; exclude_reason: string }>(
      migrator,
      "select excluded, exclude_reason from pricing.price_observations where id = $1",
      [id],
    );
    expect(row).toEqual({ excluded: true, exclude_reason: "outlier" });
    await migrator.query(
      "update pricing.price_observations set excluded = false, exclude_reason = null where id = $1",
      [id],
    );
  });

  it("refuses a changed price, DELETE and TRUNCATE", async () => {
    const id = await observation();
    expect(
      (await pgError(migrator, "update pricing.price_observations set price_sum = 1 where id = $1", [id])).message,
    ).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "delete from pricing.price_observations where id = $1", [id])).message).toMatch(
      APPEND_ONLY,
    );
    expect((await pgError(migrator, "truncate pricing.price_observations")).message).toMatch(APPEND_ONLY);
  });

  it("refuses a flag without a reason and a reason without the flag", async () => {
    const id = await observation();
    expect(
      (await pgError(migrator, "update pricing.price_observations set excluded = true where id = $1", [id])).message,
    ).toMatch(/price_observations_excluded_chk/);
    expect(
      (await pgError(migrator, "update pricing.price_observations set exclude_reason = 'stale' where id = $1", [id]))
        .message,
    ).toMatch(/price_observations_excluded_chk/);
  });
});

describe("sales.payments", () => {
  it("moves only expected -> confirmed with the confirmation fields", async () => {
    const { orderId } = await createOrder(migrator);
    const id = await insertPayment(migrator, { orderId, kind: "fee_advance", amount: 450_000 });
    await migrator.query(
      `update sales.payments set status = 'confirmed', fiscal_receipt_no = 'R-1', confirmed_by = 'owner', confirmed_at = now()
        where id = $1`,
      [id],
    );
    const row = await one<{ status: string }>(migrator, "select status from sales.payments where id = $1", [id]);
    expect(row.status).toBe("confirmed");
  });

  it("moves expected -> void", async () => {
    const { orderId } = await createOrder(migrator);
    const id = await insertPayment(migrator, { orderId, kind: "purchase_funds", amount: 1_000_000 });
    await migrator.query("update sales.payments set status = 'void' where id = $1", [id]);
  });

  it("freezes a confirmed or void payment", async () => {
    const { orderId } = await createOrder(migrator);
    const confirmed = await insertPayment(migrator, {
      orderId,
      kind: "fee_advance",
      amount: 450_000,
      status: "confirmed",
    });
    expect(
      (await pgError(migrator, "update sales.payments set status = 'void' where id = $1", [confirmed])).message,
    ).toMatch(APPEND_ONLY);
    expect(
      (await pgError(migrator, "update sales.payments set bank_doc_no = 'x' where id = $1", [confirmed])).message,
    ).toMatch(APPEND_ONLY);
    const voided = await insertPayment(migrator, { orderId, kind: "purchase_funds", amount: 1, status: "expected" });
    await migrator.query("update sales.payments set status = 'void' where id = $1", [voided]);
    expect(
      (
        await pgError(
          migrator,
          "update sales.payments set status = 'confirmed', confirmed_at = now(), confirmed_by = 'x' where id = $1",
          [voided],
        )
      ).message,
    ).toMatch(APPEND_ONLY);
  });

  it("never changes the amount, kind, method, direction or order of an expected payment", async () => {
    const { orderId } = await createOrder(migrator);
    const id = await insertPayment(migrator, { orderId, kind: "fee_advance", amount: 450_000 });
    for (const set of ["amount_sum = 1", "kind = 'fee_extra'", "method = 'merchant_card'", "direction = 'out'"]) {
      const e = await pgError(
        migrator,
        `update sales.payments set status = 'confirmed', fiscal_receipt_no = 'R', confirmed_by = 'o', confirmed_at = now(), ${set} where id = $1`,
        [id],
      );
      expect(e.message, set).toMatch(/append_only|payments_/);
    }
  });

  it("refuses an expected payment edit that does not change the status", async () => {
    const { orderId } = await createOrder(migrator);
    const id = await insertPayment(migrator, { orderId, kind: "fee_advance", amount: 450_000 });
    expect(
      (await pgError(migrator, "update sales.payments set bank_doc_no = 'x' where id = $1", [id])).message,
    ).toMatch(APPEND_ONLY);
  });

  it("refuses DELETE and TRUNCATE", async () => {
    const { orderId } = await createOrder(migrator);
    const id = await insertPayment(migrator, { orderId, kind: "fee_advance", amount: 450_000 });
    expect((await pgError(migrator, "delete from sales.payments where id = $1", [id])).message).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "truncate sales.payments")).message).toMatch(APPEND_ONLY);
  });

  it("corrects a confirmed payment with a reversing row of the negative amount", async () => {
    const { orderId } = await createOrder(migrator);
    const original = await insertPayment(migrator, {
      orderId,
      kind: "purchase_funds",
      amount: 2_000_000,
      status: "confirmed",
    });
    await migrator.query(
      `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, reversal_of, confirmed_by, confirmed_at)
       values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', -2000000, 'confirmed', $2, 'owner', now())`,
      [orderId, original],
    );
    const sum = await one<{ s: string }>(
      migrator,
      "select sum(amount_sum)::text as s from sales.payments where order_id = $1 and status = 'confirmed'",
      [orderId],
    );
    expect(sum.s).toBe("0");
    // A positive reversal and a negative ordinary payment are both refused.
    expect(
      (
        await pgError(
          migrator,
          `insert into sales.payments (order_id, kind, direction, method, amount_sum, reversal_of) values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', 5, $2)`,
          [orderId, original],
        )
      ).message,
    ).toMatch(/payments_amount_chk/);
    expect(
      (
        await pgError(
          migrator,
          `insert into sales.payments (order_id, kind, direction, method, amount_sum) values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', -5)`,
          [orderId],
        )
      ).message,
    ).toMatch(/payments_amount_chk/);
  });

  it("refuses a confirmed payment without who and when", async () => {
    const { orderId } = await createOrder(migrator);
    const e = await pgError(
      migrator,
      `insert into sales.payments (order_id, kind, direction, method, amount_sum, status)
       values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', 100, 'confirmed')`,
      [orderId],
    );
    expect(e.message).toMatch(/payments_confirmed_chk/);
  });
});

describe("ai.messages", () => {
  async function conversation(purgeAfter: string): Promise<string> {
    const c = await one<{ id: string }>(
      migrator,
      `insert into ai.conversations (channel, lang, model, purge_after) values ('web', 'uz', 'test-model', $1) returning id`,
      [purgeAfter],
    );
    await migrator.query(
      "insert into ai.messages (conversation_id, seq, role, content, shown_text) values ($1, 1, 'user', '\"hi\"', 'hi'), ($1, 2, 'assistant', '\"hello\"', 'hello')",
      [c.id],
    );
    return c.id;
  }

  it("refuses UPDATE, DELETE and TRUNCATE", async () => {
    const id = await conversation("2099-01-01T00:00:00Z");
    expect(
      (await pgError(migrator, "update ai.messages set shown_text = 'x' where conversation_id = $1", [id])).message,
    ).toMatch(APPEND_ONLY);
    expect((await pgError(migrator, "delete from ai.messages where conversation_id = $1", [id])).message).toMatch(
      APPEND_ONLY,
    );
    expect((await pgError(migrator, "truncate ai.messages")).message).toMatch(APPEND_ONLY);
  });

  it("is purged only through ai.purge_expired(), and only what is due", async () => {
    const old = await conversation("2020-01-01T00:00:00Z");
    const fresh = await conversation("2099-01-01T00:00:00Z");
    const r = await one<{ n: number }>(admin, "select ai.purge_expired(now()) as n");
    expect(r.n).toBeGreaterThanOrEqual(1);
    const gone = await migrator.query("select 1 from ai.conversations where id = $1", [old]);
    const goneMsgs = await migrator.query("select 1 from ai.messages where conversation_id = $1", [old]);
    const kept = await migrator.query("select 1 from ai.messages where conversation_id = $1", [fresh]);
    expect([gone.rowCount, goneMsgs.rowCount, kept.rowCount]).toEqual([0, 0, 2]);
  });

  it("does not let a caller fake the purge flag", async () => {
    const id = await conversation("2020-01-01T00:00:00Z");
    await admin.query("select set_config('nivel.ai_purge', 'on', false)");
    const e = await pgError(admin, "delete from ai.messages where conversation_id = $1", [id]);
    expect(e.code).toBe("42501"); // no DELETE right at all
    await admin.query("select set_config('nivel.ai_purge', 'off', false)");
  });
});
