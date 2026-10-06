import { sales } from "@nivel/db/repos";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../orders/dispatch.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import {
  customerActor,
  ownerActor,
  purchasedOrder,
  purchasingOrder,
  SYSTEM,
  type TestOrder,
} from "../orders/test-support/flow.ts";
import { createWorld, DAY, PC_COMPONENTS_SUM, type World } from "../orders/test-support/world.ts";
import { confirm, expect as expectPayment } from "../payments/index.ts";
import { accept, generate, object, resolveObjection, send } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => w.clock.set(new Date("2026-10-13T10:00:00+05:00"))); // Tuesday

const owner = () => ownerActor(w);
const orderRow = async (id: string) =>
  (await w.db.$client.query("select * from sales.orders where id = $1", [id])).rows[0];
const reportRow = async (id: string) =>
  (await w.db.$client.query("select * from sales.commission_reports where id = $1", [id])).rows[0];
const remainderOf = (o: TestOrder) => o.quote.totals.purchaseLimit - PC_COMPONENTS_SUM;

describe("reports.generate", () => {
  it("builds the report from the purchases: received, spent, the remainder and the lines", async () => {
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    expect(r).toMatchObject({
      version: 1,
      receivedSum: o.quote.totals.purchaseLimit,
      spentSum: PC_COMPONENTS_SUM,
      remainderSum: remainderOf(o),
    });
    const row = await reportRow(r.reportId);
    expect(row.received_sum).toBe(String(o.quote.totals.purchaseLimit));
    expect(row.lines).toHaveLength(8);
    expect(row.lines[0]).toMatchObject({ receiptKind: "fiscal" });
    expect(row.sent_at).toBeNull();
  });

  it("a new generation is a new version; the old one stays", async () => {
    const o = await purchasedOrder(w);
    const a = await generate({ orderId: o.orderId }, owner(), w.admin);
    const b = await generate({ orderId: o.orderId }, owner(), w.admin);
    expect([a.version, b.version]).toEqual([1, 2]);
  });

  it("is made while the purchases run or are closed, not before the money came or after the report went out", async () => {
    const { acceptedOrder } = await import("../orders/test-support/flow.ts");
    const early = await acceptedOrder(w);
    await expect(generate({ orderId: early.orderId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "order_status" }],
    });
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    expect((await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin)).ok).toBe(true);
    await expect(generate({ orderId: o.orderId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "order_status" }],
    });
  });

  it("is a job of the owner in the admin role", async () => {
    const o = await purchasedOrder(w);
    await expect(generate({ orderId: o.orderId }, owner(), w.bot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(generate({ orderId: o.orderId }, customerActor(o), w.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      generate({ orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reports.send: SEND_REPORT", () => {
  it("sends the report: the window of three working days, five days for the refund, the remainder is expected", async () => {
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    const out = await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin);
    expect(out).toEqual({ ok: true, status: "report_sent" });

    const order = await orderRow(o.orderId);
    // Tuesday 13 October 10:00 + 3 working days = Friday 16 October; + 5 = Monday 19 October (Saturday works, Sunday does not).
    expect(order.objection_until).toEqual(new Date("2026-10-16T10:00:00+05:00"));
    expect(order.refund_due_at).toEqual(new Date("2026-10-19T10:00:00+05:00"));
    const rep = await reportRow(r.reportId);
    expect(rep.sent_at).toEqual(w.clock.now());
    expect(rep.objection_until).toEqual(new Date("2026-10-16T10:00:00+05:00"));

    const refund = await w.db.$client.query(
      "select kind, method, direction, amount_sum::int as amount, status from sales.payments where order_id = $1 and kind = 'remainder_refund'",
      [o.orderId],
    );
    expect(refund.rows).toEqual([
      {
        kind: "remainder_refund",
        method: "bank_transfer_out",
        direction: "out",
        amount: remainderOf(o),
        status: "expected",
      },
    ]);
    const jobs = await w.db.$client.query(
      "select payload->>'job' as job from ops.outbox where payload->>'orderId' = $1 order by created_at",
      [o.orderId],
    );
    const names = jobs.rows.map((j) => j.job);
    expect(names).toEqual(expect.arrayContaining(["pdf.render", "objection_window", "refund_due"]));
  });

  it("refuses a report that no longer matches the purchases, and one that is not the latest version", async () => {
    const o = await purchasedOrder(w);
    const a = await generate({ orderId: o.orderId }, owner(), w.admin);
    const b = await generate({ orderId: o.orderId }, owner(), w.admin);
    await expect(send({ orderId: o.orderId, reportId: a.reportId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "report_outdated" }],
    });
    // The shop takes the cooler back after the report was calculated: the report is stale.
    const [first] = await sales.listPurchases(w.db, o.orderId);
    await sales.returnPurchase(w.db, (first as { id: string }).id, { amountSum: 1_000, boughtBy: "test" });
    await expect(send({ orderId: o.orderId, reportId: b.reportId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "report_outdated" }],
    });
    expect((await orderRow(o.orderId)).status).toBe("report_due");
  });

  it("refuses a report that does not exist or belongs to another order", async () => {
    const o = await purchasedOrder(w);
    const other = await purchasedOrder(w);
    w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
    const foreign = await generate({ orderId: other.orderId }, owner(), w.admin);
    await expect(send({ orderId: o.orderId, reportId: foreign.reportId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "report_unknown" }],
    });
    await expect(
      send({ orderId: o.orderId, reportId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, owner(), w.admin),
    ).rejects.toMatchObject({
      issues: [{ code: "report_unknown" }],
    });
  });

  it("is refused while the purchases are not closed", async () => {
    const o = await purchasingOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    expect(await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("is sent once: a retry returns the same answer and writes nothing new", async () => {
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin);
    const before = (
      await w.db.$client.query("select count(*)::int as n from ops.outbox where payload->>'orderId' = $1", [o.orderId])
    ).rows[0].n;
    expect(await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin)).toEqual({
      ok: true,
      status: "report_sent",
    });
    const after = (
      await w.db.$client.query("select count(*)::int as n from ops.outbox where payload->>'orderId' = $1", [o.orderId])
    ).rows[0].n;
    expect(after).toBe(before);
  });
});

describe("the answer of the customer to the report", () => {
  async function sentReport() {
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin);
    return { o, reportId: r.reportId };
  }

  it("an objection within the window keeps the report open; the owner resolves it; then the customer accepts", async () => {
    const { o } = await sentReport();
    expect(
      await object({ orderId: o.orderId, text: "The SSD is not the one I chose" }, customerActor(o), w.bot),
    ).toEqual({ ok: true, status: "report_sent" });
    expect(await accept({ orderId: o.orderId }, customerActor(o), w.bot)).toEqual({
      ok: false,
      error: "report_objection_open",
    });
    await resolveObjection(
      { orderId: o.orderId, note: "Shown the receipt, the model is the one on the quote" },
      owner(),
      w.admin,
    );
    expect(await accept({ orderId: o.orderId }, customerActor(o), w.bot)).toEqual({ ok: true, status: "report_sent" });
  });

  it("an objection after the window is too late", async () => {
    const { o } = await sentReport();
    w.clock.advance(4 * DAY); // Saturday 17 October: the window closed on Friday 16
    expect(await object({ orderId: o.orderId, text: "Late" }, customerActor(o), w.bot)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("the term decides for the silent customer: accepted by the system only after the window", async () => {
    const { o } = await sentReport();
    expect(await dispatch(o.orderId, { type: "REPORT_DEEMED_ACCEPTED" }, SYSTEM, w.worker)).toEqual({
      ok: false,
      error: "report_objection_open",
    });
    w.clock.advance(4 * DAY);
    expect(await dispatch(o.orderId, { type: "REPORT_DEEMED_ACCEPTED" }, SYSTEM, w.worker)).toEqual({
      ok: true,
      status: "report_sent",
    });
  });

  it("the customer's acceptance is asked once", async () => {
    const { o } = await sentReport();
    expect((await accept({ orderId: o.orderId }, customerActor(o), w.bot)).ok).toBe(true);
    expect(await dispatch(o.orderId, { type: "REPORT_DEEMED_ACCEPTED" }, SYSTEM, w.worker)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("resolving needs an open objection and a note, and is for the owner in the admin role", async () => {
    const { o } = await sentReport();
    await expect(resolveObjection({ orderId: o.orderId, note: "x" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "no_open_objection" }],
    });
    await object({ orderId: o.orderId, text: "Question" }, customerActor(o), w.bot);
    await expect(resolveObjection({ orderId: o.orderId, note: "  " }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(resolveObjection({ orderId: o.orderId, note: "ok" }, owner(), w.bot)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await resolveObjection({ orderId: o.orderId, note: "answered" }, owner(), w.admin);
    const { rows } = await w.db.$client.query(
      "select objection from sales.commission_reports where order_id = $1 order by version desc limit 1",
      [o.orderId],
    );
    expect(rows[0].objection).toMatchObject({ note: "answered" });
    expect(Date.parse(rows[0].objection.resolvedAt)).toBe(w.clock.now().getTime());
  });
});

describe("the remainder and the reserve", () => {
  it("REMAINDER_SETTLED needs the report accepted and the remainder returned; then the tax reserve is set aside", async () => {
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin);
    const settle = (refundPaymentId?: string) =>
      dispatch(
        o.orderId,
        { type: "REMAINDER_SETTLED", ...(refundPaymentId ? { refundPaymentId } : {}) },
        owner(),
        w.admin,
      );
    expect(await settle()).toEqual({ ok: false, error: "report_objection_open" }); // not accepted yet
    await accept({ orderId: o.orderId }, customerActor(o), w.bot);
    expect(await settle()).toEqual({ ok: false, error: "not_reconciled" }); // the remainder has not gone back

    const refund = (
      await w.db.$client.query("select id from sales.payments where order_id = $1 and kind = 'remainder_refund'", [
        o.orderId,
      ])
    ).rows[0].id;
    expect(await settle(refund)).toEqual({ ok: false, error: "not_reconciled" }); // expected, not confirmed: nothing went back yet
    await confirm({ paymentId: refund, bankDocNo: "PP-REFUND" }, owner(), w.admin);
    expect(await settle(refund)).toEqual({ ok: true, status: "settled" });

    // 1 % of the receipts, rounded up, until the tax authority answers in writing.
    const ledger = await w.db.$client.query(
      "select fund, amount_sum::int as amount, reason from sales.reserve_ledger where order_id = $1",
      [o.orderId],
    );
    expect(ledger.rows).toEqual([
      { fund: "tax_risk", amount: Math.ceil(PC_COMPONENTS_SUM / 100), reason: `order ${o.number}: REMAINDER_SETTLED` },
    ]);
  });

  it("a refund that is not a refund of the remainder does not count", async () => {
    const o = await purchasedOrder(w);
    const r = await generate({ orderId: o.orderId }, owner(), w.admin);
    await send({ orderId: o.orderId, reportId: r.reportId }, owner(), w.admin);
    await accept({ orderId: o.orderId }, customerActor(o), w.bot);
    const remainder = (
      await w.db.$client.query("select id from sales.payments where order_id = $1 and kind = 'remainder_refund'", [
        o.orderId,
      ])
    ).rows[0].id;
    await confirm({ paymentId: remainder, bankDocNo: "PP-REMAINDER" }, owner(), w.admin);
    const wrong = (await expectPayment({ orderId: o.orderId, kind: "fee_refund", amountSum: 1_000 }, owner(), w.admin))
      .paymentId;
    await confirm({ paymentId: wrong, bankDocNo: "PP-W" }, owner(), w.admin);
    expect(await dispatch(o.orderId, { type: "REMAINDER_SETTLED", refundPaymentId: wrong }, owner(), w.admin)).toEqual({
      ok: false,
      error: "payments_incomplete",
    });
  });
});
