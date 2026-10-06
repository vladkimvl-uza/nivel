import { ops } from "@nivel/db/repos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../orders/errors.ts";
import { record as recordPurchase } from "../purchases/index.ts";
import { acceptedOrder, ownerActor, purchasingOrder } from "../test-support/flow.ts";
import { createWorld, newFile, type World } from "../test-support/world.ts";
import { status } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

describe("threshold.status", () => {
  it("is empty and far from the limit before any deal", async () => {
    const s = await status({}, w.admin);
    expect(s).toMatchObject({
      year: 2026,
      limit: 1_000_000_000,
      volume: 0,
      committed: 0,
      shareBp: 0,
      overPlanCap: false,
    });
    expect(s.remaining).toBe(1_000_000_000);
  });

  it("counts the receipts of purchases and the fee received as deals, and the accepted estimates as committed", async () => {
    const o = await purchasingOrder(w); // advance paid, funds received, purchase started
    const line = (
      await w.db.$client.query("select id from sales.quote_lines where quote_id = $1 and product_id = $2", [
        o.quoteId,
        w.products.cpu.id,
      ])
    ).rows[0];
    const r = await recordPurchase(
      {
        orderId: o.orderId,
        vendorId: w.vendorId,
        quoteLineId: line.id,
        qty: 1,
        amountSum: w.products.cpu.price,
        paidVia: "bank_transfer",
        receiptKind: "fiscal",
        receiptNo: "CH-T-1",
        receiptFileIds: [await newFile(w)],
      },
      ownerActor(w),
      w.admin,
    );
    expect(r.ok).toBe(true);
    const waiting = await acceptedOrder(w); // accepted, nothing bought yet

    const s = await status({}, w.admin);
    expect(s.volume).toBe(w.products.cpu.price + o.quote.totals.advance);
    expect(s.committed).toBe(waiting.quote.totals.purchaseLimit + waiting.quote.totals.fee.total);
    expect(s.shareBp).toBe(Math.floor((s.volume * 10_000) / 1_000_000_000));
    expect(s.projectedShareBp).toBeGreaterThanOrEqual(s.shareBp);
  });

  it("counts the income of the other activity of the sole proprietor too, and takes the fee back when it is refunded", async () => {
    const before = await status({}, w.admin);
    await w.db.$client.query(
      "insert into sales.other_income (year, period, amount_sum, entered_by) values (2026, '2026-09', 12000000, 'owner')",
    );
    const after = await status({}, w.admin);
    expect(after.volume - before.volume).toBe(12_000_000);
  });

  it("takes the proportion of the registration year from the settings of the owner: 15 October gives 210 958 904", async () => {
    await ops.setSetting(
      w.db,
      "money.threshold",
      {
        annualLimit: 1_000_000_000,
        planCap: 200_000_000,
        alertsBp: [6000, 7000, 8000, 9000, 10000],
        proportion: "without_registration_day",
        registrationDate: "2026-10-15",
      },
      "test",
    );
    expect((await status({}, w.admin)).limit).toBe(210_958_904);
    expect((await status({ year: 2027 }, w.admin)).limit).toBe(1_000_000_000);
    await ops.setSetting(
      w.db,
      "money.threshold",
      {
        annualLimit: 1_000_000_000,
        alertsBp: [6000],
        proportion: "with_registration_day",
        registrationDate: "2026-10-15",
      },
      "test",
    );
    expect((await status({}, w.admin)).limit).toBe(213_698_630);
  });

  it("raises the alerts that the share has crossed and the sign of the plan being exceeded", async () => {
    await ops.setSetting(
      w.db,
      "money.threshold",
      {
        annualLimit: 30_000_000,
        planCap: 10_000_000,
        alertsBp: [1000, 5000, 9000],
        proportion: "without_registration_day",
      },
      "test",
    );
    const s = await status({}, w.admin);
    expect(s.crossedAlerts.length).toBeGreaterThan(0);
    expect(s.overPlanCap).toBe(true);
  });

  it("reads the year of the business calendar of Tashkent from the clock of the process", async () => {
    w.clock.set(new Date("2026-12-31T20:00:00Z")); // already 2027 in Tashkent
    try {
      expect((await status({}, w.admin)).year).toBe(2027);
    } finally {
      w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    }
  });

  it("is read by the admin and the worker, not by the bot or the site", async () => {
    expect((await status({}, w.worker)).year).toBe(2026);
    await expect(status({}, w.bot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(status({}, w.web)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a year that is not a year", async () => {
    await expect(status({ year: 20.5 }, w.admin)).rejects.toMatchObject({ name: "ValidationError" });
    await expect(status({ year: 1999 }, w.admin)).rejects.toMatchObject({ name: "ValidationError" });
  });
});
