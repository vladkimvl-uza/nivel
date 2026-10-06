import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  createOrder,
  createVendor,
  driveTo,
  insertPurchase,
  one,
  pgError,
  receiveFunds,
} from "./testkit.ts";

// WP-00 (g): the state of the warranty fund for the contribution at HANDOVER. The site and the bot cannot read the ledger,
// the orders or the cases, so a contribution computed in their process used the rate of a "young" fund. The function
// answers four aggregates to every role, without a single row of the registers.
let migrator: pg.Client;
const clients = {} as Record<"WEB" | "ADMIN" | "BOT" | "WORKER", pg.Client>;

const STATE = "select * from sales.warranty_fund_state($1::timestamptz)";
const DENIED = "42501";

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  for (const role of ["WEB", "ADMIN", "BOT", "WORKER"] as const) clients[role] = await connectAs(role);
});
afterAll(async () => {
  for (const c of [migrator, ...Object.values(clients)]) await c.end();
});

interface State {
  out_balance: string;
  out_closed_orders: number;
  out_losses_12m: string;
  out_purchased_12m: string;
}
const stateAs = async (c: pg.Client, now: string | null = null) => {
  const { rows } = await c.query<State>(STATE, [now]);
  return rows;
};
const numbers = (s: State | undefined) => ({
  balance: Number(s?.out_balance),
  closed: s?.out_closed_orders,
  losses: Number(s?.out_losses_12m),
  purchased: Number(s?.out_purchased_12m),
});

describe("sales.warranty_fund_state", () => {
  it("answers one row of four aggregates, the same to every role", async () => {
    const answers = [];
    for (const role of ["WEB", "ADMIN", "BOT", "WORKER"] as const) {
      const rows = await stateAs(clients[role]);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
        "out_balance",
        "out_closed_orders",
        "out_losses_12m",
        "out_purchased_12m",
      ]);
      answers.push(numbers(rows[0]));
    }
    for (const a of answers) expect(a).toEqual(answers[0]);
  });

  it("is executable by the four roles and not by PUBLIC", async () => {
    for (const role of ["nivel_web", "nivel_admin", "nivel_bot", "nivel_worker"]) {
      const r = await one<{ ok: boolean }>(
        migrator,
        "select has_function_privilege($1, 'sales.warranty_fund_state(timestamptz)'::regprocedure, 'EXECUTE') as ok",
        [role],
      );
      expect(r.ok, role).toBe(true);
    }
    const pub = await one<{ ok: boolean }>(
      migrator,
      "select has_function_privilege('public', 'sales.warranty_fund_state(timestamptz)'::regprocedure, 'EXECUTE') as ok",
    );
    expect(pub.ok).toBe(false);
  });

  it("does not open the registers behind it: the site and the bot still cannot read them", async () => {
    for (const role of ["WEB", "BOT"] as const) {
      expect((await pgError(clients[role], "select * from sales.reserve_ledger")).code).toBe(DENIED);
    }
    expect((await pgError(clients.WEB, "select * from sales.warranty_cases")).code).toBe(DENIED);
    expect((await pgError(clients.WEB, "select * from sales.orders")).code).toBe(DENIED);
  });
});

describe("what the aggregates count", () => {
  it("counts the balance of the warranty fund only, signed, without the tax fund", async () => {
    const before = numbers((await stateAs(clients.WEB))[0]);
    await migrator.query(
      `insert into sales.reserve_ledger (fund, amount_sum, reason) values
         ('warranty', 500000, 'contribution'), ('warranty', 300000, 'contribution'), ('warranty', -120000, 'spent'),
         ('tax_risk', 900000, 'other fund')`,
    );
    const after = numbers((await stateAs(clients.WEB))[0]);
    expect(after.balance - before.balance).toBe(680_000);
  });

  it("counts the closed orders, once each, from the journal of their events", async () => {
    const before = numbers((await stateAs(clients.BOT))[0]);
    const a = await createOrder(migrator);
    const b = await createOrder(migrator);
    const open = await createOrder(migrator);
    await driveTo(migrator, a.orderId, "closed");
    await driveTo(migrator, b.orderId, "closed");
    await driveTo(migrator, open.orderId, "handed_over");
    const after = numbers((await stateAs(clients.BOT))[0]);
    expect(after.closed).toBe((before.closed ?? 0) + 2);
  });

  it("sums the losses of the last 12 months from the cases opened in them, and the purchases of the same months", async () => {
    const o = await createOrder(migrator);
    await receiveFunds(migrator, o.orderId, 3_000_000);
    const vendorId = await createVendor(migrator);
    const before = numbers((await stateAs(clients.WORKER))[0]);
    await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 1_000_000 });
    await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 400_000 });
    // A purchase of long ago is out of the window.
    const old = await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 200_000 });
    await migrator.query("update sales.purchases set bought_at = now() - interval '13 months' where id = $1", [old]);
    const cases = [
      ["G-2998-0001", "now() - interval '2 months'", 70_000],
      ["G-2998-0002", "now() - interval '11 months'", 30_000],
      ["G-2998-0003", "now() - interval '13 months'", 999_000],
    ] as const;
    for (const [number, openedAt, cost] of cases) {
      await migrator.query(
        `insert into sales.warranty_cases (number, order_id, opened_at, description, cost_from_reserve_sum)
         values ($1, $2, ${openedAt}, 'test', $3)`,
        [number, o.orderId, cost],
      );
    }
    const after = numbers((await stateAs(clients.WORKER))[0]);
    expect(after.losses - before.losses).toBe(100_000);
    expect(after.purchased - before.purchased).toBe(1_400_000);
  });

  it("counts a return to the shop as the minus it is", async () => {
    const o = await createOrder(migrator);
    await receiveFunds(migrator, o.orderId, 2_000_000);
    const vendorId = await createVendor(migrator);
    const p = await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: 800_000 });
    const before = numbers((await stateAs(clients.WEB))[0]);
    await insertPurchase(migrator, { orderId: o.orderId, vendorId, amount: -300_000, refundOf: p });
    expect(numbers((await stateAs(clients.WEB))[0]).purchased - before.purchased).toBe(-300_000);
  });

  it("looks at the moment the caller names, never later than the clock of the database", async () => {
    const now = numbers((await stateAs(clients.ADMIN))[0]);
    const future = numbers((await stateAs(clients.ADMIN, "2999-01-01T00:00:00Z"))[0]);
    expect(future).toEqual(now);
    const past = numbers((await stateAs(clients.ADMIN, "2000-01-01T00:00:00Z"))[0]);
    expect(past).toEqual({ balance: 0, closed: 0, losses: 0, purchased: 0 });
  });

  it("reads a missing moment as now", async () => {
    const { rows } = await clients.WEB.query<State>("select * from sales.warranty_fund_state()");
    expect(numbers(rows[0])).toEqual(numbers((await stateAs(clients.WEB))[0]));
  });
});
