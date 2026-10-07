import { DbRuleError } from "@nivel/db/repos";
import { bp, sum } from "@nivel/domain/money";
import { taxRiskReserve, warrantyReserveContribution } from "@nivel/domain/reserve";
import { describe, expect, it } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import { recordingLogger } from "../../queues/test-support/fakes.ts";
import { handleLedgerAppend, type LedgerPort, lossesBpOf } from "./ledger-append.ts";

const ORDER = "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11";

interface Setup {
  receipts?: number;
  taxActive?: boolean;
  fund?: { balance: number; closedOrders: number; lossesLast12m: number; purchasedLast12m: number };
  booked?: boolean;
  order?: { number: string } | null;
  appendError?: Error;
}

function setup(o: Setup = {}) {
  const appended: { fund: string; amountSum: number; reason: string; orderId: string }[] = [];
  const port: LedgerPort = {
    order: async () => (o.order === undefined ? { number: "NV-2026-0001" } : o.order),
    alreadyBooked: async () => o.booked ?? false,
    receiptsTotal: async () => o.receipts ?? 7_500_000,
    taxRiskActive: async () => o.taxActive ?? true,
    fundState: async () => o.fund ?? { balance: 0, closedOrders: 0, lossesLast12m: 0, purchasedLast12m: 0 },
    append: async (e) => {
      if (o.appendError) throw o.appendError;
      appended.push(e);
    },
  };
  const { log, lines } = recordingLogger();
  const run = (data: Record<string, unknown>) => handleLedgerAppend({ log, port }, data);
  return { run, appended, lines };
}

describe("handleLedgerAppend: the contribution is the domain's, from the receipts of the order", () => {
  it("books the tax-risk reserve as the domain counts it from the receipts, not the sum of the payload", async () => {
    const t = setup({ receipts: 1_234_599 });
    const result = await t.run({ orderId: ORDER, fund: "tax_risk", amountSum: 999_999_999, reason: "whatever" });
    expect(result).toEqual({ booked: 12_346 });
    expect(t.appended).toEqual([
      {
        fund: "tax_risk",
        amountSum: taxRiskReserve(sum(1_234_599), true),
        reason: "order NV-2026-0001: REMAINDER_SETTLED",
        orderId: ORDER,
      },
    ]);
    expect(t.appended[0]?.amountSum).toBe(12_346); // 1 %, rounded up (ADR-007)
  });

  it("books the warranty reserve of a young fund: 2 % of the receipts, not less than 150 000", async () => {
    const t = setup({ receipts: 7_500_001 });
    await t.run({ orderId: ORDER, fund: "warranty" });
    expect(t.appended[0]).toMatchObject({
      fund: "warranty",
      amountSum: 150_001,
      reason: "order NV-2026-0001: HANDOVER",
    });
  });

  it("books the minimum of 150 000 for a small order of a young fund", async () => {
    const t = setup({ receipts: 3_000_000 });
    await t.run({ orderId: ORDER, fund: "warranty" });
    expect(t.appended[0]?.amountSum).toBe(150_000);
  });

  it("books the 1 % of a mature fund: the state of the fund is read from the database, not from the payload", async () => {
    const fund = { balance: 12_000_000, closedOrders: 31, lossesLast12m: 0, purchasedLast12m: 400_000_000 };
    const t = setup({ receipts: 10_000_000, fund });
    await t.run({ orderId: ORDER, fund: "warranty", amountSum: 200_000 });
    expect(t.appended[0]?.amountSum).toBe(
      warrantyReserveContribution(sum(10_000_000), {
        balance: sum(12_000_000),
        closedOrders: 31,
        lossesLast12mBp: bp(0),
      }),
    );
    expect(t.appended[0]?.amountSum).toBe(100_000);
  });

  it("goes back to 2 % when the losses of the year are high", async () => {
    const fund = { balance: 12_000_000, closedOrders: 31, lossesLast12m: 3_000_000, purchasedLast12m: 300_000_000 };
    const t = setup({ receipts: 10_000_000, fund });
    await t.run({ orderId: ORDER, fund: "warranty" });
    expect(t.appended[0]?.amountSum).toBe(200_000);
  });

  it("writes nothing for an order with no receipts: the domain reserves nothing for it", async () => {
    const t = setup({ receipts: 0 });
    expect(await t.run({ orderId: ORDER, fund: "warranty" })).toEqual({ nothingToBook: true });
    expect(await t.run({ orderId: ORDER, fund: "tax_risk" })).toEqual({ nothingToBook: true });
    expect(t.appended).toEqual([]);
  });

  it("writes nothing for the tax-risk reserve once the tax office has answered (money.tax_risk_active is off)", async () => {
    const t = setup({ taxActive: false });
    expect(await t.run({ orderId: ORDER, fund: "tax_risk" })).toEqual({ nothingToBook: true });
    expect(t.appended).toEqual([]);
  });

  it("books once: a repeat of the job finds the entry and writes nothing (the fund has grown since, the rate may differ)", async () => {
    const t = setup({ booked: true });
    expect(await t.run({ orderId: ORDER, fund: "warranty" })).toEqual({ alreadyBooked: true });
    expect(t.appended).toEqual([]);
  });

  it("takes reserve_exceeded of the database as 'already booked': a second writer got there first", async () => {
    const t = setup({
      appendError: new DbRuleError(
        "check_violation",
        "reserve_exceeded: the order has 150000 booked, the limit is 150000",
      ),
    });
    expect(await t.run({ orderId: ORDER, fund: "warranty" })).toEqual({ alreadyBooked: true });
  });

  it("lets the job be retried when the milestone is not there yet (reserve_not_due): the event may be a moment behind", async () => {
    const t = setup({
      appendError: new DbRuleError("check_violation", "reserve_not_due: the order has not reached handed_over"),
    });
    const error = await t.run({ orderId: ORDER, fund: "warranty" }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
    expect(error.message).toContain("reserve_not_due");
  });

  it.each(["invalid_reserve", "order_not_found"])("refuses for good what the database calls %s", async (key) => {
    const t = setup({ appendError: new DbRuleError("check_violation", `${key}: no`) });
    await expect(t.run({ orderId: ORDER, fund: "warranty" })).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("refuses a job whose order is not there", async () => {
    const t = setup({ order: null });
    await expect(t.run({ orderId: ORDER, fund: "warranty" })).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("refuses a payload with a fund that does not exist or no order", async () => {
    const t = setup();
    for (const data of [
      {},
      { orderId: ORDER },
      { orderId: ORDER, fund: "salary" },
      { orderId: 12, fund: "warranty" },
    ]) {
      await expect(t.run(data)).rejects.toBeInstanceOf(PermanentJobError);
    }
    expect(t.appended).toEqual([]);
  });

  it("passes on other errors for pg-boss to retry", async () => {
    const t = setup({ appendError: new Error("connection terminated") });
    const error = await t.run({ orderId: ORDER, fund: "tax_risk" }).catch((e) => e);
    expect(error).not.toBeInstanceOf(PermanentJobError);
  });
});

describe("lossesBpOf: the losses of the year in basis points of what was bought", () => {
  it("is zero without losses, whole basis points rounded down, and 10 000 at most", () => {
    expect(lossesBpOf(0, 100)).toBe(0);
    expect(lossesBpOf(-5, 100)).toBe(0);
    expect(lossesBpOf(1, 3)).toBe(3333);
    expect(lossesBpOf(50, 10_000)).toBe(50);
    expect(lossesBpOf(200, 100)).toBe(10_000);
  });

  it("is the whole 100 % when something was lost and nothing was bought", () => {
    expect(lossesBpOf(60_000, 0)).toBe(10_000);
  });
});
