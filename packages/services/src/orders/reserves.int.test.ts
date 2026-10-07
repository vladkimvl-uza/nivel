import { sales } from "@nivel/db/repos";
import { sum } from "@nivel/domain/money";
import { warrantyReserveContribution } from "@nivel/domain/reserve";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadReserves } from "./snapshot.ts";
import { createWorld, newCustomer, type World } from "./test-support/world.ts";

// The contribution to the warranty fund at HANDOVER depends on the state of the fund. The site and the bot cannot read the
// ledger, the orders or the cases; they used to count a "young" fund and the contribution depended on the role that
// happened to press the button. The state now comes from sales.warranty_fund_state(), the same for every role.
let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const roles = () =>
  [
    ["admin", w.admin],
    ["bot", w.bot],
    ["web", w.web],
    ["worker", w.worker],
  ] as const;

describe("loadReserves", () => {
  it("is the same for every role, with the fund the ledger holds", async () => {
    await w.db.$client.query(
      "insert into sales.reserve_ledger (fund, amount_sum, reason) values ('warranty', 4000000, 'test'), ('tax_risk', 900000, 'other fund')",
    );
    const states = await Promise.all(roles().map(([, rt]) => loadReserves(rt.db, rt.now())));
    for (const s of states) expect(s).toEqual(states[0]);
    expect(states[0]?.warranty.balance).toBe(4_000_000);
    expect(states[0]?.taxRiskActive).toBe(true);
  });

  it("gives a mature fund the 1 % of the contribution to the site and to the bot too, not the 2 % of a young fund", async () => {
    await w.db.$client.query(
      "insert into sales.reserve_ledger (fund, amount_sum, reason) values ('warranty', 8000000, 'test')",
    );
    for (let i = 0; i < 30; i++) {
      const { id } = await sales.createOrder(w.db, { customerId: await newCustomer(w), kind: "pc" });
      await w.db.$client.query(
        `insert into sales.order_events (order_id, seq, actor_kind, actor_id, event, from_status, to_status)
         values ($1, 1, 'system', 'system', '{"type":"CLOSE"}', 'handed_over', 'closed')`,
        [id],
      );
    }
    const contributions: Record<string, number> = {};
    for (const [name, rt] of roles()) {
      const state = await loadReserves(rt.db, rt.now());
      expect(state.warranty.closedOrders).toBeGreaterThanOrEqual(30);
      expect(state.warranty.balance).toBeGreaterThanOrEqual(10_000_000);
      contributions[name] = warrantyReserveContribution(sum(10_000_000), state.warranty);
    }
    expect(contributions).toEqual({ admin: 100_000, bot: 100_000, web: 100_000, worker: 100_000 });
  });

  it("counts the losses of the last 12 months against what was bought, and a loss that is high takes the fund back to 2 %", async () => {
    const { id } = await sales.createOrder(w.db, { customerId: await newCustomer(w), kind: "pc" });
    // 60 000 of cases and no purchases at all: the losses are the whole of what was bought, 100 %.
    await w.db.$client.query(
      "insert into sales.warranty_cases (number, order_id, description, cost_from_reserve_sum) values ('G-2998-0101', $1, 'test', 60000)",
      [id],
    );
    for (const [, rt] of roles()) {
      const state = await loadReserves(rt.db, rt.now());
      expect(state.warranty.lossesLast12mBp).toBe(10_000);
      expect(warrantyReserveContribution(sum(10_000_000), state.warranty)).toBe(200_000);
    }
  });
});
