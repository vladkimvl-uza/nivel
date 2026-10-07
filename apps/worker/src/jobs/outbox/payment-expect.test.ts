import { DbRuleError } from "@nivel/db/repos";
import { orders } from "@nivel/services";
import { describe, expect, it, vi } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import { recordingLogger } from "../../queues/test-support/fakes.ts";
import { handlePaymentExpect } from "./payment-expect.ts";

const ORDER = "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11";

function run(
  expectFromJob: (input: { orderId: string; paymentKind: string; amountSum?: number }) => Promise<{
    paymentId: string;
    created: boolean;
  }>,
  data: Record<string, unknown>,
) {
  const { log, lines } = recordingLogger();
  return { promise: handlePaymentExpect({ log, expectFromJob }, data), lines };
}

describe("handlePaymentExpect: the sum is the database's, the payload is a hint", () => {
  it("hands the kind and the sum of the hint to payments.expectFromJob, which checks them against the database", async () => {
    const expectFromJob = vi.fn(async () => ({ paymentId: "p-1", created: true }));
    const { promise } = run(expectFromJob, {
      job: "payment.expect",
      orderId: ORDER,
      paymentKind: "fee_advance",
      amountSum: 2_000_000,
    });
    await expect(promise).resolves.toEqual({ paymentId: "p-1", created: true });
    expect(expectFromJob).toHaveBeenCalledWith({ orderId: ORDER, paymentKind: "fee_advance", amountSum: 2_000_000 });
  });

  it("works without a hint of the sum", async () => {
    const expectFromJob = vi.fn(async () => ({ paymentId: "p-1", created: false }));
    const { promise } = run(expectFromJob, { orderId: ORDER, paymentKind: "purchase_funds" });
    await expect(promise).resolves.toEqual({ paymentId: "p-1", created: false });
    expect(expectFromJob).toHaveBeenCalledWith({ orderId: ORDER, paymentKind: "purchase_funds" });
  });

  it("takes a repeated job as done: the same expectation comes back", async () => {
    const expectFromJob = vi.fn(async () => ({ paymentId: "p-1", created: false }));
    const first = await run(expectFromJob, { orderId: ORDER, paymentKind: "fee_final" }).promise;
    const second = await run(expectFromJob, { orderId: ORDER, paymentKind: "fee_final" }).promise;
    expect((second as { paymentId: string }).paymentId).toBe((first as { paymentId: string }).paymentId);
  });

  it("is done when there is nothing to expect (a refund paid already, a settlement without a debt)", async () => {
    const expectFromJob = vi.fn(async () => {
      throw orders.ValidationError.of("paymentKind", "amount_zero", "there is no sum of fee_refund to expect");
    });
    const { promise, lines } = run(expectFromJob, { orderId: ORDER, paymentKind: "fee_refund" });
    await expect(promise).resolves.toEqual({ nothingToExpect: true });
    expect(lines.some((l) => l.level === "info")).toBe(true);
  });

  it.each([
    [
      "a sum that is not the database's",
      orders.ValidationError.of("amountSum", "amount_mismatch", "the sum is 5, the job names 6"),
    ],
    ["a kind no event expects", orders.ValidationError.of("paymentKind", "kind_not_derivable", "not a payment")],
    ["an order in another status", orders.ValidationError.of("paymentKind", "order_status", "wrong status")],
    ["an order with no accepted quote", orders.ValidationError.of("orderId", "no_accepted_quote", "none")],
    ["an order that is not there", new orders.NotFoundError("order")],
    ["a role without the right", new orders.ForbiddenError("the worker role cannot do payments.expect")],
    ["a broken installation", new orders.ConfigError("the clock returned an invalid date")],
    [
      "an open expectation of another sum",
      new DbRuleError("invalid_payment", "invalid_payment: another sum is expected"),
    ],
  ])("refuses for good %s: a retry would only repeat the refusal", async (_name, error) => {
    const expectFromJob = vi.fn(async () => {
      throw error;
    });
    const { promise } = run(expectFromJob, { orderId: ORDER, paymentKind: "fee_advance", amountSum: 1 });
    await expect(promise).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("lets pg-boss retry what may pass: a database that is down", async () => {
    const expectFromJob = vi.fn(async () => {
      throw new Error("connection terminated");
    });
    const { promise } = run(expectFromJob, { orderId: ORDER, paymentKind: "fee_advance" });
    await expect(promise).rejects.toThrow("connection terminated");
    await expect(promise).rejects.not.toBeInstanceOf(PermanentJobError);
  });

  it("refuses a payload without an order or a kind, and never calls the scenario", async () => {
    const expectFromJob = vi.fn();
    for (const data of [{}, { orderId: ORDER }, { paymentKind: "fee_advance" }, { orderId: 5, paymentKind: "x" }]) {
      await expect(run(expectFromJob, data).promise).rejects.toBeInstanceOf(PermanentJobError);
    }
    expect(expectFromJob).not.toHaveBeenCalled();
  });

  it("does not pass a hint that is not a whole sum: the scenario refuses what is not whole, so the job does not pretend", async () => {
    const expectFromJob = vi.fn();
    await expect(
      run(expectFromJob, { orderId: ORDER, paymentKind: "fee_advance", amountSum: 1.5 }).promise,
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(expectFromJob).not.toHaveBeenCalled();
  });
});
