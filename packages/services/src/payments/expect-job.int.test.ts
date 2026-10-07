import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancel } from "../orders/cancel-order.ts";
import { dispatch } from "../orders/dispatch.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import {
  acceptConsents,
  acceptedOrder,
  customerActor,
  ownerActor,
  paidOrder,
  purchasedOrder,
  sentOrder,
  settledOrder,
  type TestOrder,
} from "../orders/test-support/flow.ts";
import { createWorld, type World } from "../orders/test-support/world.ts";
import { generate as generateReport, send as sendReport } from "../reports/index.ts";
import { expectFromJob } from "./index.ts";

// The job `payment.expect` is queued by the site (it may not write payments). The worker runs it with this scenario: the
// payload only names the kind, every sum is taken from the quote, the report and the settlement of the cancellation, and a
// sum in the payload that is not the same is refused (ARCHITECTURE 4.6, outbox/contract.ts).
let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const paymentsOf = async (orderId: string) =>
  (
    await w.db.$client.query(
      "select kind, direction, method, status, amount_sum::int as amount from sales.payments where order_id = $1 order by kind, created_at",
      [orderId],
    )
  ).rows;

/** The customer accepts through the site: the site writes no payment, it queues the jobs. */
async function acceptedThroughSite(): Promise<TestOrder> {
  const o = await sentOrder(w);
  const consentIds = await acceptConsents(w, o);
  const r = await dispatch(
    o.orderId,
    { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "site" },
    customerActor(o),
    w.web,
  );
  expect(r).toEqual({ ok: true, status: "accepted" });
  return o;
}

describe("payments.expectFromJob: the payments of the acceptance", () => {
  it("expects the advance and the money for the purchases with the sums of the quote, as the worker", async () => {
    const o = await acceptedThroughSite();
    expect(await paymentsOf(o.orderId)).toEqual([]);
    const advance = await expectFromJob({ orderId: o.orderId, paymentKind: "fee_advance" }, w.worker);
    const funds = await expectFromJob(
      { orderId: o.orderId, paymentKind: "purchase_funds", amountSum: o.quote.totals.purchaseLimit },
      w.worker,
    );
    expect(advance.created).toBe(true);
    expect(funds.created).toBe(true);
    expect(await paymentsOf(o.orderId)).toEqual([
      { kind: "fee_advance", direction: "in", method: "xolis_qr", status: "expected", amount: o.quote.totals.advance },
      {
        kind: "purchase_funds",
        direction: "in",
        method: "bank_transfer_ip",
        status: "expected",
        amount: o.quote.totals.purchaseLimit,
      },
    ]);
  });

  it("is repeatable: the job that runs twice leaves one expectation", async () => {
    const o = await acceptedThroughSite();
    const a = await expectFromJob({ orderId: o.orderId, paymentKind: "fee_advance" }, w.worker);
    const b = await expectFromJob({ orderId: o.orderId, paymentKind: "fee_advance" }, w.bot);
    expect(b).toEqual({ paymentId: a.paymentId, created: false });
    expect(await paymentsOf(o.orderId)).toHaveLength(1);
  });

  it("refuses a sum in the payload that is not the sum of the quote, and writes nothing", async () => {
    const o = await acceptedThroughSite();
    await expect(
      expectFromJob(
        { orderId: o.orderId, paymentKind: "fee_advance", amountSum: o.quote.totals.advance - 1 },
        w.worker,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "amountSum", code: "amount_mismatch" }] });
    await expect(
      expectFromJob({ orderId: o.orderId, paymentKind: "fee_advance", amountSum: 1.5 }, w.worker),
    ).rejects.toMatchObject({ issues: [{ path: "amountSum", code: "sum_invalid" }] });
    expect(await paymentsOf(o.orderId)).toEqual([]);
  });

  it("does not expect what the status of the order does not call for: a hint of the site is not a reason", async () => {
    const o = await sentOrder(w); // not accepted yet
    for (const paymentKind of [
      "fee_advance",
      "purchase_funds",
      "fee_final",
      "remainder_refund",
      "fee_refund",
    ] as const) {
      await expect(expectFromJob({ orderId: o.orderId, paymentKind }, w.worker)).rejects.toMatchObject({
        issues: [{ path: "paymentKind", code: "order_status" }],
      });
    }
    const accepted = await acceptedOrder(w);
    await expect(
      expectFromJob({ orderId: accepted.orderId, paymentKind: "fee_final" }, w.worker),
    ).rejects.toMatchObject({
      issues: [{ code: "order_status" }],
    });
    expect(await paymentsOf(o.orderId)).toEqual([]);
  });

  it("refuses the kinds that no event of the automaton expects: they are entered by the owner", async () => {
    const o = await acceptedThroughSite();
    for (const paymentKind of ["purchase_topup", "podbor_fee", "warranty", ""] as const) {
      await expect(
        expectFromJob({ orderId: o.orderId, paymentKind: paymentKind as never }, w.worker),
      ).rejects.toMatchObject({
        issues: [{ path: "paymentKind", code: "kind_not_derivable" }],
      });
    }
  });

  it("refuses an order that does not exist, a bad id and the roles that may not call the function", async () => {
    const o = await acceptedThroughSite();
    await expect(
      expectFromJob({ orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", paymentKind: "fee_advance" }, w.worker),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(expectFromJob({ orderId: "x", paymentKind: "fee_advance" }, w.worker)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(expectFromJob({ orderId: o.orderId, paymentKind: "fee_advance" }, w.web)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(expectFromJob({ orderId: o.orderId, paymentKind: "fee_advance" }, w.admin)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await paymentsOf(o.orderId)).toEqual([]);
  });
});

describe("payments.expectFromJob: the payments after the cancellation and the report", () => {
  it("takes the refunds and the extra fee from the settlement the server kept with the CANCEL event", async () => {
    const o = await paidOrder(w);
    // The owner cancels through the admin panel, which writes the expectations itself: take them away to run the job.
    const r = await cancel({ orderId: o.orderId, reason: "test" }, ownerActor(w), w.admin);
    expect(r).toEqual({ ok: true, status: "cancelling" });
    const kept = (await w.db.$client.query("select cancel from sales.orders where id = $1", [o.orderId])).rows[0].cancel
      .settlement as { feeToRefund: number; feeToInvoice: number; fundsToRefund: number };
    await w.db.$client.query("update sales.payments set status = 'void' where order_id = $1 and status = 'expected'", [
      o.orderId,
    ]);
    const made: Record<string, number> = {};
    for (const [paymentKind, sumOf] of [
      ["fee_refund", kept.feeToRefund],
      ["fee_extra", kept.feeToInvoice],
      ["funds_refund", kept.fundsToRefund],
    ] as const) {
      if (sumOf === 0) {
        await expect(expectFromJob({ orderId: o.orderId, paymentKind }, w.worker)).rejects.toMatchObject({
          issues: [{ code: "amount_zero" }],
        });
        continue;
      }
      await expectFromJob({ orderId: o.orderId, paymentKind }, w.worker);
      made[paymentKind] = sumOf;
    }
    const rows = await w.db.$client.query(
      "select kind, amount_sum::int as amount from sales.payments where order_id = $1 and status = 'expected' order by kind",
      [o.orderId],
    );
    expect(Object.fromEntries(rows.rows.map((p) => [p.kind, p.amount]))).toEqual(made);
    expect(Object.keys(made).length).toBeGreaterThan(0);
  });

  it("a job that is delivered again after the owner confirmed the payment finds nothing to expect (refunds and extra fee)", async () => {
    const o = await paidOrder(w);
    await cancel({ orderId: o.orderId, reason: "test" }, ownerActor(w), w.admin);
    const kept = (await w.db.$client.query("select cancel from sales.orders where id = $1", [o.orderId])).rows[0].cancel
      .settlement as { feeToRefund: number; feeToInvoice: number; fundsToRefund: number };
    await w.db.$client.query("update sales.payments set status = 'void' where order_id = $1 and status = 'expected'", [
      o.orderId,
    ]);
    let checked = 0;
    for (const [paymentKind, sumOf] of [
      ["fee_refund", kept.feeToRefund],
      ["fee_extra", kept.feeToInvoice],
      ["funds_refund", kept.fundsToRefund],
    ] as const) {
      if (sumOf === 0) continue;
      const made = await expectFromJob({ orderId: o.orderId, paymentKind }, w.worker);
      // The owner confirms it (the bank document, or the receipt of the fee), as the admin panel does.
      await w.db.$client.query(
        `update sales.payments set status = 'confirmed', bank_doc_no = 'BD-1', fiscal_receipt_no = case when direction = 'in' then 'F-1' end,
                confirmed_by = 'test', confirmed_at = now()
          where id = $1`,
        [made.paymentId],
      );
      // The same job again (a retry of the outbox): the whole settlement is paid, nothing is expected twice.
      await expect(expectFromJob({ orderId: o.orderId, paymentKind }, w.worker)).rejects.toMatchObject({
        issues: [{ code: "amount_zero" }],
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    const open = await w.db.$client.query(
      "select count(*)::int as n from sales.payments where order_id = $1 and status = 'expected'",
      [o.orderId],
    );
    expect(open.rows[0].n).toBe(0);
  });

  it("takes the refund of the remainder from the money of the order, not from the job, once the report is out", async () => {
    const o = await purchasedOrder(w);
    const report = await generateReport({ orderId: o.orderId }, ownerActor(w), w.admin);
    const sent = await sendReport({ orderId: o.orderId, reportId: report.reportId }, ownerActor(w), w.admin);
    expect(sent.ok).toBe(true);
    // The admin side wrote the expectation with SEND_REPORT; void it to run the job as the worker would after the site's request.
    const written = await paymentsOf(o.orderId);
    const refund = written.find((p) => p.kind === "remainder_refund");
    expect(refund?.amount).toBeGreaterThan(0);
    await w.db.$client.query(
      "update sales.payments set status = 'void' where order_id = $1 and kind = 'remainder_refund'",
      [o.orderId],
    );
    await expect(
      expectFromJob(
        { orderId: o.orderId, paymentKind: "remainder_refund", amountSum: (refund?.amount ?? 0) + 1 },
        w.worker,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "amountSum", code: "amount_mismatch" }] });
    const made = await expectFromJob({ orderId: o.orderId, paymentKind: "remainder_refund" }, w.worker);
    expect(made.created).toBe(true);
    const rows = await paymentsOf(o.orderId);
    expect(rows.filter((p) => p.kind === "remainder_refund" && p.status === "expected")).toEqual([
      {
        kind: "remainder_refund",
        direction: "out",
        method: "bank_transfer_out",
        status: "expected",
        amount: refund?.amount,
      },
    ]);
  });

  it("finds nothing to expect for the remainder once it is returned", async () => {
    const o = await settledOrder(w);
    // The order is settled: the remainder has been returned, nothing is left to expect.
    await expect(
      expectFromJob({ orderId: o.orderId, paymentKind: "remainder_refund" }, w.worker),
    ).rejects.toMatchObject({
      issues: [{ code: "amount_zero" }],
    });
  });
});
