import { readFileSync } from "node:fs";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  createOrder,
  createVendor,
  driveTo,
  insertConsent,
  insertPayment,
  insertPurchase,
  one,
  pgError,
  receiveFunds,
  transition,
} from "./testkit.ts";

// ARCHITECTURE 3.4: the second line of defence for money. The cases live in a table that is data, not code
// (packages/testing/fixtures/wp-06/db-money-cases.json); the same shape is meant for the shared money-cases.json.
interface PairCase {
  name: string;
  kind: string;
  direction: "in" | "out";
  method: string;
  status: "expected" | "confirmed" | "void";
  receipt: string | null;
  ok: boolean;
  constraint?: string;
}
interface LimitCase {
  name: string;
  limit: number;
  funds: number;
  purchases: number[];
  overrunConsent: "none" | "granted" | "withdrawn";
  ok: boolean;
  error?: string;
}
interface ReconcileCase {
  name: string;
  funds: number;
  purchases: number[];
  refunds: number[];
  losses: number;
  ok: boolean;
}
const cases = JSON.parse(
  readFileSync(new URL("../../../testing/fixtures/wp-06/db-money-cases.json", import.meta.url), "utf8"),
) as { paymentPairs: PairCase[]; purchaseLimit: LimitCase[]; reconcile: ReconcileCase[] };

let migrator: pg.Client;
let admin: pg.Client;
let vendorId: string;

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
  vendorId = await createVendor(migrator);
});
afterAll(async () => {
  await migrator.end();
  await admin.end();
});

describe("payment pairs: kind x method x direction", () => {
  it("covers every payment kind of the architecture", () => {
    const kinds = new Set(cases.paymentPairs.map((c) => c.kind));
    for (const k of [
      "fee_advance",
      "fee_final",
      "fee_extra",
      "podbor_fee",
      "purchase_funds",
      "purchase_topup",
      "remainder_refund",
      "fee_refund",
      "funds_refund",
    ])
      expect(kinds.has(k), k).toBe(true);
  });

  it.each(cases.paymentPairs)("$name", async (c) => {
    const { orderId } = await createOrder(migrator);
    const run = () =>
      insertPayment(migrator, {
        orderId,
        kind: c.kind,
        direction: c.direction,
        method: c.method,
        status: c.status,
        receipt: c.receipt,
        amount: 1_000_000,
      });
    if (c.ok) {
      await expect(run()).resolves.toBeTypeOf("string");
    } else {
      await expect(run()).rejects.toThrow(new RegExp(c.constraint ?? "payments_"));
    }
  });
});

async function limitScenario(c: Pick<LimitCase, "limit" | "funds" | "overrunConsent">) {
  const o = await createOrder(migrator, { purchaseLimit: c.limit });
  await receiveFunds(migrator, o.orderId, c.funds);
  if (c.overrunConsent !== "none") {
    await insertConsent(migrator, {
      orderId: o.orderId,
      customerId: o.customerId,
      kind: "limit_overrun",
      granted: true,
      at: "2026-10-01T10:00:00Z",
    });
  }
  if (c.overrunConsent === "withdrawn") {
    await insertConsent(migrator, {
      orderId: o.orderId,
      customerId: o.customerId,
      kind: "limit_overrun",
      granted: false,
      at: "2026-10-02T10:00:00Z",
    });
  }
  return o;
}

describe("purchase limit and received funds", () => {
  it.each(cases.purchaseLimit)("$name", async (c) => {
    const o = await limitScenario(c);
    for (const [i, amount] of c.purchases.entries()) {
      const last = i === c.purchases.length - 1;
      const run = () => insertPurchase(migrator, { orderId: o.orderId, vendorId, amount });
      if (c.ok || !last) await expect(run()).resolves.toBeTypeOf("string");
      else await expect(run()).rejects.toThrow(new RegExp(c.error ?? "."));
    }
  });

  it("matches a model of the rule on random sequences (seeded, repeatable)", async () => {
    let seed = 20261006;
    const rnd = (n: number) => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    for (let run = 0; run < 25; run++) {
      const limit = 1_000_000 * (1 + rnd(20));
      const funds = Math.max(0, limit + (rnd(5) - 2) * 500_000);
      const consent = (["none", "granted", "withdrawn"] as const)[rnd(3)] ?? "none";
      const o = await limitScenario({ limit, funds, overrunConsent: consent });
      let total = 0;
      for (let i = 0; i < 4; i++) {
        const amount = 1 + rnd(limit / 2);
        const next = total + amount;
        const allowed = next <= funds && (next <= limit || consent === "granted");
        const attempt = insertPurchase(migrator, { orderId: o.orderId, vendorId, amount });
        if (allowed) {
          await expect(attempt, `run ${run} #${i}`).resolves.toBeTypeOf("string");
          total = next;
        } else {
          await expect(attempt, `run ${run} #${i}`).rejects.toThrow(/limit_exceeded|funds_exceeded/);
        }
      }
    }
  });
});

describe("purchases: details of the rule", () => {
  it("refuses a purchase while the order has no current quote", async () => {
    const o = await createOrder(migrator);
    await migrator.query("update sales.orders set current_quote_id = null where id = $1", [o.orderId]);
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 100 })).rejects.toThrow(
      /no_current_quote/,
    );
  });

  it("lets a return to the shop (negative row) free the limit again", async () => {
    const o = await createOrder(migrator, { purchaseLimit: 5_000_000 });
    await receiveFunds(migrator, o.orderId, 5_000_000);
    const first = await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 5_000_000 });
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 1 })).rejects.toThrow(
      /limit_exceeded/,
    );
    await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: -2_000_000, refundOf: first });
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 2_000_000 })).resolves.toBeTypeOf(
      "string",
    );
  });

  it("checks again when an amount is raised, and keeps a purchase in its order", async () => {
    const a = await createOrder(migrator, { purchaseLimit: 5_000_000 });
    const b = await createOrder(migrator, { purchaseLimit: 5_000_000 });
    await receiveFunds(migrator, a.orderId, 5_000_000);
    const id = await insertPurchase(migrator, { orderId: a.orderId, vendorId, amount: 4_000_000 });
    expect(
      (await pgError(migrator, "update sales.purchases set amount_sum = 5000001 where id = $1", [id])).message,
    ).toMatch(/limit_exceeded/);
    await migrator.query("update sales.purchases set amount_sum = 5000000 where id = $1", [id]);
    expect(
      (await pgError(migrator, "update sales.purchases set order_id = $1 where id = $2", [b.orderId, id])).message,
    ).toMatch(/immutable/);
  });

  it("does not count unconfirmed or void funds", async () => {
    const o = await createOrder(migrator, { purchaseLimit: 5_000_000 });
    await insertPayment(migrator, {
      orderId: o.orderId,
      kind: "purchase_funds",
      amount: 5_000_000,
      status: "expected",
    });
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 1000 })).rejects.toThrow(
      /funds_exceeded/,
    );
    const voidId = await insertPayment(migrator, { orderId: o.orderId, kind: "purchase_funds", amount: 5_000_000 });
    await migrator.query("update sales.payments set status = 'void' where id = $1", [voidId]);
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 1000 })).rejects.toThrow(
      /funds_exceeded/,
    );
  });

  it("counts a top-up like the first transfer", async () => {
    const o = await createOrder(migrator, { purchaseLimit: 3_000_000 });
    await receiveFunds(migrator, o.orderId, 3_000_000);
    await insertConsent(migrator, {
      orderId: o.orderId,
      customerId: o.customerId,
      kind: "limit_overrun",
      granted: true,
    });
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 3_500_000 })).rejects.toThrow(
      /funds_exceeded/,
    );
    await insertPayment(migrator, { orderId: o.orderId, kind: "purchase_topup", amount: 500_000, status: "confirmed" });
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 3_500_000 })).resolves.toBeTypeOf(
      "string",
    );
  });

  it("needs the no_receipt_purchase consent for a purchase without a receipt", async () => {
    const o = await createOrder(migrator);
    await receiveFunds(migrator, o.orderId, 1_000_000);
    const insert = () =>
      migrator.query(
        `insert into sales.purchases (order_id, vendor_id, qty, amount_sum, paid_via, receipt_kind, bought_by)
         values ($1, $2, 1, 500000, 'bank_transfer', 'none_with_consent', 'test')`,
        [o.orderId, vendorId],
      );
    await expect(insert()).rejects.toThrow(/consent_missing/);
    await insertConsent(migrator, {
      orderId: o.orderId,
      customerId: o.customerId,
      kind: "no_receipt_purchase",
      granted: true,
    });
    await expect(insert()).resolves.toBeDefined();
  });

  it("refuses a fiscal purchase without a receipt number and an ESF purchase without an ESF status", async () => {
    const o = await createOrder(migrator);
    await receiveFunds(migrator, o.orderId, 1_000_000);
    const base = `insert into sales.purchases (order_id, vendor_id, qty, amount_sum, paid_via, receipt_kind, bought_by`;
    expect(
      (
        await pgError(migrator, `${base}) values ($1, $2, 1, 100, 'bank_transfer', 'fiscal', 'test')`, [
          o.orderId,
          vendorId,
        ])
      ).message,
    ).toMatch(/purchases_fiscal_chk/);
    expect(
      (
        await pgError(migrator, `${base}) values ($1, $2, 1, 100, 'bank_transfer', 'esf', 'test')`, [
          o.orderId,
          vendorId,
        ])
      ).message,
    ).toMatch(/purchases_esf_chk/);
  });

  it("refuses a negative purchase that is not a return, and a return that is positive", async () => {
    const o = await createOrder(migrator);
    await receiveFunds(migrator, o.orderId, 1_000_000);
    const p = await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 100 });
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: -100 })).rejects.toThrow(
      /purchases_amount_chk/,
    );
    await expect(insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 100, refundOf: p })).rejects.toThrow(
      /purchases_amount_chk/,
    );
  });
});

describe("reconciliation when an order closes or is cancelled", () => {
  async function prepare(c: ReconcileCase): Promise<string> {
    const o = await createOrder(migrator, { purchaseLimit: 10_000_000 });
    await receiveFunds(migrator, o.orderId, c.funds);
    for (const amount of c.purchases) await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount });
    for (const amount of c.refunds) {
      await insertPayment(migrator, { orderId: o.orderId, kind: "remainder_refund", amount, status: "confirmed" });
    }
    if (c.losses)
      await migrator.query("update sales.orders set documented_losses_sum = $1 where id = $2", [c.losses, o.orderId]);
    return o.orderId;
  }

  it.each(cases.reconcile)("close: $name", async (c) => {
    const orderId = await prepare(c);
    await driveTo(admin, orderId, "handed_over");
    if (c.ok) {
      expect((await transition(admin, orderId, "CLOSE")).to).toBe("closed");
    } else {
      await expect(transition(admin, orderId, "CLOSE")).rejects.toThrow(/not_reconciled/);
      const row = await one<{ status: string }>(migrator, "select status from sales.orders where id = $1", [orderId]);
      expect(row.status).toBe("handed_over");
    }
  });

  it.each(cases.reconcile)("cancel: $name", async (c) => {
    const orderId = await prepare(c);
    await driveTo(admin, orderId, "accepted");
    await transition(admin, orderId, "CANCEL");
    if (c.ok) {
      expect((await transition(admin, orderId, "CANCEL_SETTLED")).to).toBe("cancelled");
    } else {
      await expect(transition(admin, orderId, "CANCEL_SETTLED")).rejects.toThrow(/not_reconciled/);
    }
  });

  it("does not count unconfirmed refunds and treats a funds_refund like a remainder refund", async () => {
    const o = await createOrder(migrator, { purchaseLimit: 10_000_000 });
    await receiveFunds(migrator, o.orderId, 10_000_000);
    await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 6_000_000 });
    await insertPayment(migrator, { orderId: o.orderId, kind: "funds_refund", amount: 4_000_000, status: "expected" });
    await driveTo(admin, o.orderId, "handed_over");
    await expect(transition(admin, o.orderId, "CLOSE")).rejects.toThrow(/not_reconciled/);
    await insertPayment(migrator, { orderId: o.orderId, kind: "funds_refund", amount: 4_000_000, status: "confirmed" });
    expect((await transition(admin, o.orderId, "CLOSE")).to).toBe("closed");
  });

  it("matches a model of the equation on random sets (seeded, repeatable)", async () => {
    let seed = 7_000_007;
    const rnd = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    for (let run = 0; run < 25; run++) {
      const funds = 1 + rnd(9_000_000);
      const spent = rnd(funds + 1);
      const loss = rnd(funds - spent + 1);
      let refund = funds - spent - loss;
      const balanced = rnd(2) === 0;
      if (!balanced) refund = Math.max(0, refund + (rnd(2) === 0 ? 1 : -1) * (1 + rnd(1000)));
      const c: ReconcileCase = {
        name: `run ${run}`,
        funds,
        purchases: spent > 0 ? [spent] : [],
        refunds: refund > 0 ? [refund] : [],
        losses: loss,
        ok: funds === spent + refund + loss,
      };
      const orderId = await prepare(c);
      await driveTo(admin, orderId, "handed_over");
      const attempt = transition(admin, orderId, "CLOSE");
      if (c.ok) await expect(attempt, c.name).resolves.toMatchObject({ to: "closed" });
      else await expect(attempt, c.name).rejects.toThrow(/not_reconciled/);
    }
  });
});
