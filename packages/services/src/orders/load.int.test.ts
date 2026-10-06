// The free window (DECISIONS R-8): fewer than two orders in work and no order of the full cycle (from 6.7 million) in the queue.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancel } from "./cancel-order.ts";
import { freeWindowAvailable, IN_WORK_LIMIT } from "./load.ts";
import { acceptedOrder, ownerActor, purchasingOrder } from "./test-support/flow.ts";
import { createWorld, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => w.clock.set(new Date("2026-10-12T10:00:00+05:00")));

const settings = { minFullCyclePc: 6_700_000 };
const small = {
  lines: [],
  manualLines: [
    { title: "Study PC", categoryCode: "case" as const, feeGroup: "pc" as const, qty: 1, unitSum: 5_000_000 },
  ],
};

describe("freeWindowAvailable", () => {
  it("reads the minimum of the full cycle from the settings: a lower minimum makes the small PC a queue of its own", async () => {
    await acceptedOrder(w, small);
    expect(await freeWindowAvailable(w.db, settings)).toBe(true);
    expect(await freeWindowAvailable(w.db, { minFullCyclePc: 4_000_000 })).toBe(false);
  });

  it("follows the load of the workshop: the orders in work and the orders of the full cycle that wait", async () => {
    expect(IN_WORK_LIMIT).toBe(2);
    expect(await freeWindowAvailable(w.db, settings)).toBe(true); // nothing in work, only a small PC in the queue

    await purchasingOrder(w); // one order in work
    expect(await freeWindowAvailable(w.db, settings)).toBe(true);

    // The small PC that waits (see above) does not take the window away.
    w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    const big = await acceptedOrder(w); // an order of the full cycle waits for its turn
    expect(await freeWindowAvailable(w.db, settings)).toBe(false);

    // The customer withdraws: the queue is free again.
    expect(await cancel({ orderId: big.orderId, reason: "changed his mind" }, ownerActor(w), w.admin)).toEqual({
      ok: true,
      status: "cancelling",
    });
    expect(await freeWindowAvailable(w.db, settings)).toBe(true);

    await purchasingOrder(w); // the second order in work: the limit is reached
    expect(await freeWindowAvailable(w.db, settings)).toBe(false);
  });
});
