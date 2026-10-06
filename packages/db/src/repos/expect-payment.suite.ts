import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, one, pgError } from "./testkit.ts";

// WP-00 (a): the bot and the worker expect payments after ACCEPT and CANCEL through sales.expect_payment(); the site
// never does (its job travels through the outbox). Every test runs under the real role of the application.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const DENIED = "42501";
const CALL = "select * from sales.expect_payment($1::uuid, $2, $3::bigint, $4)";

beforeAll(async () => {
  [migrator, web, admin, bot, worker] = await Promise.all([
    connectAs("MIGRATOR"),
    connectAs("WEB"),
    connectAs("ADMIN"),
    connectAs("BOT"),
    connectAs("WORKER"),
  ]);
});
afterAll(async () => {
  for (const c of [migrator, web, admin, bot, worker]) await c.end();
});

async function expectAs(
  c: pg.Client,
  orderId: string,
  kind: string,
  amount: number | null,
  method: string | null = null,
) {
  const { rows } = await c.query<{ out_payment_id: string; out_duplicate: boolean }>(CALL, [
    orderId,
    kind,
    amount,
    method,
  ]);
  return rows[0];
}

const payments = (orderId: string) =>
  migrator
    .query(
      `select kind, direction, method, amount_sum::int as amount, status, payer_is_customer, reversal_of
         from sales.payments where order_id = $1 order by created_at, id`,
      [orderId],
    )
    .then((r) => r.rows);

const PAIRS = [
  ["fee_advance", "in", "xolis_qr"],
  ["fee_final", "in", "xolis_qr"],
  ["fee_extra", "in", "xolis_qr"],
  ["podbor_fee", "in", "xolis_qr"],
  ["purchase_funds", "in", "bank_transfer_ip"],
  ["purchase_topup", "in", "bank_transfer_ip"],
  ["remainder_refund", "out", "bank_transfer_out"],
  ["fee_refund", "out", "bank_transfer_out"],
  ["funds_refund", "out", "bank_transfer_out"],
] as const;

describe.each(["worker", "bot"] as const)("sales.expect_payment as the %s role", (role) => {
  const client = () => (role === "worker" ? worker : bot);

  it("runs in the session of the real role", async () => {
    const r = await one<{ current_user: string; session_user: string }>(client(), "select current_user, session_user");
    expect(r).toEqual({ current_user: `nivel_${role}`, session_user: `nivel_${role}` });
  });

  it.each(PAIRS)("%s: writes an expected payment with direction %s and method %s", async (kind, direction, method) => {
    const o = await createOrder(migrator);
    const r = await expectAs(client(), o.orderId, kind, 450_000);
    expect(r?.out_duplicate).toBe(false);
    expect(await payments(o.orderId)).toEqual([
      { kind, direction, method, amount: 450_000, status: "expected", payer_is_customer: true, reversal_of: null },
    ]);
    const row = await one<{ id: string }>(migrator, "select id from sales.payments where order_id = $1", [o.orderId]);
    expect(r?.out_payment_id).toBe(row.id);
  });

  it("lets a fee go through the card of the merchant, the one pair the domain allows besides the QR", async () => {
    const o = await createOrder(migrator);
    await expectAs(client(), o.orderId, "fee_extra", 100_000, "merchant_card");
    expect((await payments(o.orderId))[0]).toMatchObject({ method: "merchant_card", direction: "in" });
  });

  it.each([
    ["fee_advance", "bank_transfer_ip"],
    ["fee_advance", "bank_transfer_out"],
    ["purchase_funds", "xolis_qr"],
    ["purchase_funds", "merchant_card"],
    ["purchase_topup", "bank_transfer_out"],
    ["remainder_refund", "xolis_qr"],
    ["funds_refund", "bank_transfer_ip"],
    ["fee_refund", "merchant_card"],
    ["fee_final", "cash"],
    ["fee_final", ""],
  ])("refuses the pair %s by %s and writes nothing", async (kind, method) => {
    const o = await createOrder(migrator);
    const e = await pgError(client(), CALL, [o.orderId, kind, 100_000, method]);
    expect(e.message).toMatch(/^invalid_payment:/);
    expect(await payments(o.orderId)).toEqual([]);
  });

  it.each([["warranty"], ["fee"], [""], ["FEE_ADVANCE"], [null]])("refuses the unknown kind %j", async (kind) => {
    const o = await createOrder(migrator);
    const e = await pgError(client(), CALL, [o.orderId, kind, 100_000, null]);
    expect(e.message).toMatch(/^invalid_payment:/);
    expect(await payments(o.orderId)).toEqual([]);
  });

  it.each([[0], [-1], [-450_000], [null]])(
    "refuses the sum %j: a payment is a positive whole number of sums",
    async (amount) => {
      const o = await createOrder(migrator);
      const e = await pgError(client(), CALL, [o.orderId, "fee_advance", amount, null]);
      expect(e.message).toMatch(/^invalid_payment:/);
      expect(await payments(o.orderId)).toEqual([]);
    },
  );

  it("takes the largest sum a bigint column holds and refuses what is not a whole number", async () => {
    const o = await createOrder(migrator);
    const big = "9007199254740991";
    const { rows } = await client().query(CALL, [o.orderId, "fee_extra", big, null]);
    expect(rows).toHaveLength(1);
    const e = await pgError(client(), CALL, [o.orderId, "fee_extra", "1.5", null]);
    expect(e.code).toBe("22P02");
  });

  it("refuses an order that does not exist, or none", async () => {
    const e = await pgError(client(), CALL, ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "fee_advance", 1000, null]);
    expect(e.message).toMatch(/^order_not_found:/);
    const none = await pgError(client(), CALL, [null, "fee_advance", 1000, null]);
    expect(none.message).toMatch(/^(order_not_found|invalid_payment):/);
  });

  it("a repeated request returns the expectation that is there and writes no second row", async () => {
    const o = await createOrder(migrator);
    const a = await expectAs(client(), o.orderId, "fee_advance", 450_000);
    const b = await expectAs(client(), o.orderId, "fee_advance", 450_000);
    expect(b).toEqual({ out_payment_id: a?.out_payment_id, out_duplicate: true });
    expect(await payments(o.orderId)).toHaveLength(1);
  });

  it("another sum of the same kind is another expectation (a second top-up, a second refund)", async () => {
    const o = await createOrder(migrator);
    await expectAs(client(), o.orderId, "purchase_topup", 300_000);
    const b = await expectAs(client(), o.orderId, "purchase_topup", 400_000);
    expect(b?.out_duplicate).toBe(false);
    expect(await payments(o.orderId)).toHaveLength(2);
  });

  it("a payment of the quote that is confirmed and not taken back is not expected again; after its reversal it may be", async () => {
    const o = await createOrder(migrator);
    const first = await expectAs(client(), o.orderId, "fee_advance", 450_000);
    await admin.query(
      `update sales.payments set status = 'confirmed', confirmed_by = 'test', confirmed_at = now(), fiscal_receipt_no = 'R-1'
        where id = $1`,
      [first?.out_payment_id],
    );
    const again = await expectAs(client(), o.orderId, "fee_advance", 450_000);
    expect(again).toEqual({ out_payment_id: first?.out_payment_id, out_duplicate: true });
    await admin.query(
      `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, reversal_of, confirmed_by, confirmed_at, fiscal_receipt_no)
       values ($1, 'fee_advance', 'in', 'xolis_qr', -450000, 'confirmed', $2, 'test', now(), 'R-2')`,
      [o.orderId, first?.out_payment_id],
    );
    const fresh = await expectAs(client(), o.orderId, "fee_advance", 450_000);
    expect(fresh?.out_duplicate).toBe(false);
    expect(fresh?.out_payment_id).not.toBe(first?.out_payment_id);
  });

  it("a refund that was confirmed does not stop the next refund of the same sum, a void expectation does not stop anything", async () => {
    const o = await createOrder(migrator);
    const first = await expectAs(client(), o.orderId, "remainder_refund", 200_000);
    await admin.query(
      "update sales.payments set status = 'confirmed', confirmed_by = 'test', confirmed_at = now() where id = $1",
      [first?.out_payment_id],
    );
    const second = await expectAs(client(), o.orderId, "remainder_refund", 200_000);
    expect(second?.out_duplicate).toBe(false);
    await admin.query("update sales.payments set status = 'void' where id = $1", [second?.out_payment_id]);
    const third = await expectAs(client(), o.orderId, "remainder_refund", 200_000);
    expect(third?.out_duplicate).toBe(false);
    expect(await payments(o.orderId)).toHaveLength(3);
  });

  it("two requests at the same moment write one expectation", async () => {
    const o = await createOrder(migrator);
    const [a, b] = await Promise.all([
      expectAs(worker, o.orderId, "purchase_funds", 9_500_000),
      expectAs(bot, o.orderId, "purchase_funds", 9_500_000),
    ]);
    expect(a?.out_payment_id).toBe(b?.out_payment_id);
    expect([a?.out_duplicate, b?.out_duplicate].sort()).toEqual([false, true]);
    expect(await payments(o.orderId)).toHaveLength(1);
  });

  it("leaves an audit row with the role of the database that asked", async () => {
    const o = await createOrder(migrator);
    const r = await expectAs(client(), o.orderId, "fee_final", 1_050_000);
    await expectAs(client(), o.orderId, "fee_final", 1_050_000); // a repeat is not audited again
    const audit = await migrator.query(
      "select actor, action, entity, after from sales.payments p, ops.audit_log a where p.order_id = $1 and a.entity_id = p.id::text",
      [o.orderId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor: `db:nivel_${role}`,
      action: "payment.expect",
      entity: "sales.payments",
      after: { orderId: o.orderId, kind: "fee_final", amountSum: 1_050_000, db_role: `nivel_${role}` },
    });
    expect(r?.out_payment_id).toBeTruthy();
  });

  it("still cannot write the table itself: the function is the only way", async () => {
    const o = await createOrder(migrator);
    const e = await pgError(
      client(),
      "insert into sales.payments (order_id, kind, direction, method, amount_sum) values ($1, 'fee_advance', 'in', 'xolis_qr', 1)",
      [o.orderId],
    );
    expect(e.code).toBe(DENIED);
    expect((await pgError(client(), "update sales.payments set amount_sum = 1")).code).toBe(DENIED);
  });
});

describe("who may call sales.expect_payment", () => {
  it("is not executable by the site, the admin panel (it writes the table) or PUBLIC", async () => {
    for (const [role, ok] of [
      ["nivel_worker", true],
      ["nivel_bot", true],
      ["nivel_web", false],
      ["nivel_admin", false],
      ["public", false],
    ] as const) {
      const r = await one<{ ok: boolean }>(
        migrator,
        "select has_function_privilege($1, 'sales.expect_payment(uuid,text,bigint,text,boolean)'::regprocedure, 'EXECUTE') as ok",
        [role],
      );
      expect(r.ok, role).toBe(ok);
    }
  });

  it("the site is refused before anything is read: its payload is a hint for the worker, never a payment", async () => {
    const o = await createOrder(migrator);
    expect((await pgError(web, CALL, [o.orderId, "fee_advance", 450_000, null])).code).toBe(DENIED);
    expect((await pgError(admin, CALL, [o.orderId, "fee_advance", 450_000, null])).code).toBe(DENIED);
    expect(await payments(o.orderId)).toEqual([]);
  });

  it("takes the payer flag the caller names (the money of a third person is confirmed later with a statement)", async () => {
    const o = await createOrder(migrator);
    await worker.query("select * from sales.expect_payment($1::uuid, 'purchase_funds', 1000::bigint, null, false)", [
      o.orderId,
    ]);
    expect((await payments(o.orderId))[0]).toMatchObject({ payer_is_customer: false });
  });
});
