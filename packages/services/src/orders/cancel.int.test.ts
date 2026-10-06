import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirm, voidPayment } from "../payments/index.ts";
import { cancel } from "./cancel-order.ts";
import { dispatch } from "./dispatch.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.ts";
import {
  acceptedOrder,
  customerActor,
  draftOrder,
  ownerActor,
  paidOrder,
  purchasedOrder,
  sentOrder,
} from "./test-support/flow.ts";
import { createWorld, PC_COMPONENTS_SUM, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => w.clock.set(new Date("2026-10-13T10:00:00+05:00")));

const owner = () => ownerActor(w);
const orderRow = async (id: string) =>
  (await w.db.$client.query("select * from sales.orders where id = $1", [id])).rows[0];
const payments = async (id: string) =>
  (
    await w.db.$client.query(
      "select kind, direction, method, amount_sum::int as amount, status from sales.payments where order_id = $1 order by kind",
      [id],
    )
  ).rows;

describe("orders.cancel: before the acceptance", () => {
  it("cancels a draft: nothing is earned, nothing is owed, the settlement is stored on the order", async () => {
    const o = await draftOrder(w);
    const r = await cancel({ orderId: o.orderId, reason: "the customer changed his mind" }, owner(), w.admin);
    expect(r).toEqual({ ok: true, status: "cancelling" });
    const row = await orderRow(o.orderId);
    expect(row.cancel).toMatchObject({
      point: "before_accept",
      reason: "the customer changed his mind",
      settlement: { feeEarned: 0, feeToRefund: 0, feeToInvoice: 0, fundsToRefund: 0, partsGoTo: "none" },
    });
    // Five working days from Tuesday 13 October 10:00: Monday 19 October (Saturday works, Sunday does not).
    expect(row.refund_due_at).toEqual(new Date("2026-10-19T10:00:00+05:00"));
    expect(await payments(o.orderId)).toEqual([]);
  });

  it("queues the message to the customer and the task of the accountant (the adjustment of the income, NK art. 466)", async () => {
    const o = await sentOrder(w);
    await cancel({ orderId: o.orderId, reason: "too expensive" }, owner(), w.admin);
    const { rows } = await w.db.$client.query(
      "select payload->>'target' as target, payload->>'templateKey' as key from ops.outbox where payload->>'orderId' = $1 and kind = 'telegram_message' order by created_at, id",
      [o.orderId],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { target: "customer", key: "order.cancelling" },
        { target: "owner_topic", key: "accountant.income_adjustment" },
      ]),
    );
  });

  it("is for the owner: the assistant gets actor_not_allowed, the customer cannot cancel for him", async () => {
    const o = await draftOrder(w);
    expect(
      await cancel({ orderId: o.orderId, reason: "x" }, { kind: "assistant", id: w.assistant.id }, w.admin),
    ).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
    expect(await cancel({ orderId: o.orderId, reason: "x" }, customerActor(o), w.admin)).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
    expect((await orderRow(o.orderId)).status).toBe("estimate_draft");
  });

  it("needs a reason", async () => {
    const o = await draftOrder(w);
    await expect(cancel({ orderId: o.orderId, reason: "  " }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("is repeatable: the second request is the same answer and no second settlement", async () => {
    const o = await draftOrder(w);
    await cancel({ orderId: o.orderId, reason: "x" }, owner(), w.admin);
    expect(await cancel({ orderId: o.orderId, reason: "x" }, owner(), w.admin)).toEqual({
      ok: true,
      status: "cancelling",
    });
  });
});

describe("orders.cancel: after the acceptance, before the purchase", () => {
  it("earns 20 % of the fee of the 30 % advance, gives back the rest of it and all the money for purchases", async () => {
    const o = await paidOrder(w);
    const fee = o.quote.totals.fee.total;
    const earned = Math.floor((fee * 2000) / 10_000);
    const advance = o.quote.totals.advance;
    const r = await cancel({ orderId: o.orderId, reason: "moved abroad" }, owner(), w.admin);
    expect(r).toEqual({ ok: true, status: "cancelling" });
    const row = await orderRow(o.orderId);
    expect(row.cancel.settlement).toMatchObject({
      feeEarned: earned,
      feeToRefund: advance - earned,
      feeToInvoice: 0,
      fundsToRefund: o.quote.totals.purchaseLimit,
    });
    const rows = await payments(o.orderId);
    expect(rows.filter((p) => p.status === "expected")).toEqual([
      {
        kind: "fee_refund",
        direction: "out",
        method: "bank_transfer_out",
        amount: advance - earned,
        status: "expected",
      },
      {
        kind: "funds_refund",
        direction: "out",
        method: "bank_transfer_out",
        amount: o.quote.totals.purchaseLimit,
        status: "expected",
      },
    ]);
  });

  it("cannot close the cancellation while a payment is expected, nor before the money went back; then it closes", async () => {
    const o = await paidOrder(w);
    await cancel({ orderId: o.orderId, reason: "x" }, owner(), w.admin);
    const settle = () => dispatch(o.orderId, { type: "CANCEL_SETTLED" }, owner(), w.admin);
    expect(await settle()).toEqual({ ok: false, error: "not_reconciled" }); // the money has not gone back
    const rows = (
      await w.db.$client.query("select id, kind from sales.payments where order_id = $1 and status = 'expected'", [
        o.orderId,
      ])
    ).rows;
    const funds = rows.find((p) => p.kind === "funds_refund");
    const fee = rows.find((p) => p.kind === "fee_refund");
    await confirm({ paymentId: funds.id, bankDocNo: "PP-BACK" }, owner(), w.admin);
    expect(await settle()).toEqual({ ok: false, error: "payments_incomplete" }); // the refund of the fee is still expected
    await voidPayment({ paymentId: fee.id, reason: "the fee is kept: the work was done" }, owner(), w.admin);
    expect(await settle()).toEqual({ ok: true, status: "cancelled" });
  });

  it("ignores the amounts of a settlement sent with the event: the server computes its own", async () => {
    const o = await acceptedOrder(w);
    const lie = {
      feeEarned: 1,
      feeToRefund: 999_999_999,
      feeToInvoice: 0,
      fundsToRefund: 5,
      partsGoTo: "none",
      dueBy: w.clock.now(),
    } as const;
    const r = await dispatch(
      o.orderId,
      { type: "CANCEL", point: "after_accept_before_purchase", reason: "x", settlement: lie as never },
      owner(),
      w.admin,
    );
    expect(r.ok).toBe(true);
    const row = await orderRow(o.orderId);
    expect(row.cancel.settlement.feeToRefund).toBe(0); // nothing was paid: nothing to give back
    expect(row.cancel.settlement.feeEarned).toBe(Math.floor((o.quote.totals.fee.total * 2000) / 10_000));
    expect(row.cancel.settlement.feeToInvoice).toBe(row.cancel.settlement.feeEarned); // earned and not paid: an invoice by the QR
    const ev = await w.db.$client.query(
      "select event from sales.order_events where order_id = $1 order by seq desc limit 1",
      [o.orderId],
    );
    expect(ev.rows[0].event.settlement.feeEarned).toBe(row.cancel.settlement.feeEarned);
  });

  it("invoices the earned fee that was not paid as a separate fee payment, never from the money for purchases", async () => {
    const o = await acceptedOrder(w);
    await cancel({ orderId: o.orderId, reason: "x" }, owner(), w.admin);
    const rows = await payments(o.orderId);
    const extra = rows.find((p) => p.kind === "fee_extra");
    expect(extra).toMatchObject({ direction: "in", method: "xolis_qr", status: "expected" });
    expect(rows.find((p) => p.kind === "fee_refund")).toBeUndefined();
  });

  it("refuses a point that does not belong to the status, and a status that cannot be cancelled", async () => {
    const o = await acceptedOrder(w);
    const settlement = {
      feeEarned: 0,
      feeToRefund: 0,
      feeToInvoice: 0,
      fundsToRefund: 0,
      partsGoTo: "none",
      dueBy: w.clock.now(),
    } as const;
    expect(
      await dispatch(
        o.orderId,
        { type: "CANCEL", point: "before_accept", reason: "x", settlement: settlement as never },
        owner(),
        w.admin,
      ),
    ).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect((await orderRow(o.orderId)).status).toBe("accepted");
  });

  it("works through the bot as the owner: the refunds travel as jobs, the bot writes no payments", async () => {
    const o = await paidOrder(w);
    const r = await cancel(
      { orderId: o.orderId, reason: "via the bot" },
      { kind: "owner", id: w.owner.telegramId },
      w.bot,
    );
    expect(r).toEqual({ ok: true, status: "cancelling" });
    const jobs = await w.db.$client.query(
      "select payload->>'paymentKind' as kind from ops.outbox where payload->>'orderId' = $1 and payload->>'job' = 'payment.expect' and payload->>'paymentKind' in ('fee_refund', 'funds_refund') order by 1",
      [o.orderId],
    );
    expect(jobs.rows.map((j) => j.kind)).toEqual(["fee_refund", "funds_refund"]);
  });
});

describe("orders.cancel: after the purchase", () => {
  it("settles by the receipts: the remainder of the money goes back, the parts go to the customer or the shop", async () => {
    const o = await purchasedOrder(w);
    const r = await cancel({ orderId: o.orderId, reason: "x" }, owner(), w.admin);
    expect(r).toEqual({ ok: true, status: "cancelling" });
    const row = await orderRow(o.orderId);
    expect(row.cancel.point).toBe("after_purchase_before_assembly");
    expect(row.cancel.settlement).toMatchObject({
      fundsToRefund: o.quote.totals.purchaseLimit - PC_COMPONENTS_SUM,
      partsGoTo: "shop_or_client",
      feeEarned: Math.floor((o.quote.totals.fee.total * 5000) / 10_000),
    });
  });

  it("refuses documented losses that exceed what is left of the money, with a message, not a 500", async () => {
    const o = await purchasedOrder(w);
    await expect(
      cancel({ orderId: o.orderId, reason: "x", documentedLosses: o.quote.totals.purchaseLimit }, owner(), w.admin),
    ).rejects.toMatchObject({
      name: "ValidationError",
      issues: [{ path: "settlement", code: "cancel_input_invalid" }],
    });
    expect((await orderRow(o.orderId)).status).toBe("report_due");
  });

  it("takes documented losses into the settlement and writes them on the order", async () => {
    const o = await purchasedOrder(w);
    const losses = 100_000;
    await cancel({ orderId: o.orderId, reason: "x", documentedLosses: losses }, owner(), w.admin);
    const row = await orderRow(o.orderId);
    expect(row.documented_losses_sum).toBe(String(losses));
    expect(row.cancel.settlement.fundsToRefund).toBe(o.quote.totals.purchaseLimit - PC_COMPONENTS_SUM - losses);
  });
});

describe("orders.cancel: the doors", () => {
  it("refuses an unknown order and a bad id; the site role cannot cancel", async () => {
    await expect(
      cancel({ orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", reason: "x" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancel({ orderId: "NV-2026-1", reason: "x" }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const o = await draftOrder(w);
    await expect(cancel({ orderId: o.orderId, reason: "x" }, owner(), w.web)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to cancel what is being cancelled with another reason, and a share of the assembly outside 0-10000", async () => {
    const o = await draftOrder(w);
    await cancel({ orderId: o.orderId, reason: "first" }, owner(), w.admin);
    expect(await cancel({ orderId: o.orderId, reason: "another" }, owner(), w.admin)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    const p = await draftOrder(w);
    await expect(
      cancel({ orderId: p.orderId, reason: "x", assemblyDoneBp: 20_000 }, owner(), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      cancel({ orderId: p.orderId, reason: "x", documentedLosses: -1 }, owner(), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
