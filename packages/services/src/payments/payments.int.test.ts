import { podborFee } from "@nivel/domain/fee";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { convert, create as createLead } from "../leads/index.ts";
import { dispatch } from "../orders/dispatch.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { loadFeeSettings } from "../orders/settings.ts";
import {
  acceptConsents,
  acceptedOrder,
  customerActor,
  ownerActor,
  sentOrder,
  type TestOrder,
} from "../orders/test-support/flow.ts";
import { createWorld, DAY, HOUR, newFile, pcLines, type World } from "../orders/test-support/world.ts";
import { build, send } from "../quotes/index.ts";
import { confirm, expect as expectPayment, reverse, voidPayment } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const owner = () => ownerActor(w);
const assistant = () => ({ kind: "assistant" as const, id: w.assistant.id });
const paymentRow = async (id: string) =>
  (await w.db.$client.query("select * from sales.payments where id = $1", [id])).rows[0];

async function expectAdvance(o: TestOrder): Promise<string> {
  return (await expectPayment({ orderId: o.orderId, kind: "fee_advance" }, owner(), w.admin)).paymentId;
}
async function expectFunds(o: TestOrder): Promise<string> {
  return (await expectPayment({ orderId: o.orderId, kind: "purchase_funds" }, owner(), w.admin)).paymentId;
}
const advanceOf = (o: TestOrder) => o.quote.totals.advance;
const limitOf = (o: TestOrder) => o.quote.totals.purchaseLimit;

describe("payments.expect", () => {
  it("takes the amount of the advance, of the final part and of the purchase funds from the quote, not from the caller", async () => {
    const o = await acceptedOrder(w);
    const a = await expectAdvance(o);
    const f = await expectFunds(o);
    const final = (await expectPayment({ orderId: o.orderId, kind: "fee_final" }, owner(), w.admin)).paymentId;
    expect((await paymentRow(a)).amount_sum).toBe(String(advanceOf(o)));
    expect((await paymentRow(f)).amount_sum).toBe(String(limitOf(o)));
    expect((await paymentRow(final)).amount_sum).toBe(String(o.quote.totals.final));
  });

  it("writes the pair of the kind: the fee through the QR, the funds to the account of the sole proprietor", async () => {
    const o = await acceptedOrder(w);
    const a = await paymentRow(await expectAdvance(o));
    const f = await paymentRow(await expectFunds(o));
    expect([a.method, a.direction, a.status]).toEqual(["xolis_qr", "in", "expected"]);
    expect([f.method, f.direction, f.status]).toEqual(["bank_transfer_ip", "in", "expected"]);
  });

  it("refuses an amount that is not the amount of the quote for a kind the quote fixes", async () => {
    const o = await acceptedOrder(w);
    await expect(
      expectPayment({ orderId: o.orderId, kind: "fee_advance", amountSum: advanceOf(o) - 1 }, owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ code: "amount_mismatch" }] });
    expect(
      (await expectPayment({ orderId: o.orderId, kind: "fee_advance", amountSum: advanceOf(o) }, owner(), w.admin))
        .paymentId,
    ).toBeTruthy();
  });

  it("needs an amount for the kinds the quote does not fix, and refuses a sum that is not whole or not positive", async () => {
    const o = await acceptedOrder(w);
    await expect(expectPayment({ orderId: o.orderId, kind: "purchase_topup" }, owner(), w.admin)).rejects.toMatchObject(
      {
        issues: [{ path: "amountSum", code: "sum_invalid" }],
      },
    );
    for (const amountSum of [0, -5, 1.5, Number.NaN, 1_000_000_000_001]) {
      await expect(
        expectPayment({ orderId: o.orderId, kind: "purchase_topup", amountSum }, owner(), w.admin),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(
      (await expectPayment({ orderId: o.orderId, kind: "purchase_topup", amountSum: 500_000 }, owner(), w.admin))
        .paymentId,
    ).toBeTruthy();
  });

  it("refuses the two money flows mixed", async () => {
    const o = await acceptedOrder(w);
    await expect(
      expectPayment({ orderId: o.orderId, kind: "purchase_funds", method: "xolis_qr" }, owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "method", code: "pair_invalid" }] });
    await expect(
      expectPayment(
        { orderId: o.orderId, kind: "fee_extra", amountSum: 100_000, method: "bank_transfer_ip" },
        owner(),
        w.admin,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "method", code: "pair_invalid" }] });
    expect(
      (
        await expectPayment(
          { orderId: o.orderId, kind: "fee_extra", amountSum: 100_000, method: "merchant_card" },
          owner(),
          w.admin,
        )
      ).paymentId,
    ).toBeTruthy();
  });

  it("is repeatable: the same expectation returns the same payment", async () => {
    const o = await acceptedOrder(w);
    const a = await expectAdvance(o);
    expect(await expectAdvance(o)).toBe(a);
    const { rows } = await w.db.$client.query(
      "select count(*)::int as n from sales.payments where order_id = $1 and kind = 'fee_advance'",
      [o.orderId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("is repeatable after the payment is confirmed too: a paid advance is not expected a second time", async () => {
    const o = await acceptedOrder(w);
    const a = await expectAdvance(o);
    await confirm({ paymentId: a, fiscalReceiptNo: "FR-AGAIN-1", payerIsCustomer: true }, owner(), w.admin);
    expect(await expectAdvance(o)).toBe(a);
    const funds = await expectFunds(o);
    await confirm({ paymentId: funds, bankDocNo: "BD-AGAIN-1", payerIsCustomer: true }, owner(), w.admin);
    expect(await expectFunds(o)).toBe(funds);
    const { rows } = await w.db.$client.query(
      "select count(*)::int as n from sales.payments where order_id = $1 and kind in ('fee_advance', 'purchase_funds')",
      [o.orderId],
    );
    expect(rows[0].n).toBe(2);
  });

  it("expects the advance anew once the confirmed one has been reversed", async () => {
    const o = await acceptedOrder(w);
    const a = await expectAdvance(o);
    await confirm({ paymentId: a, fiscalReceiptNo: "FR-REV-1", payerIsCustomer: true }, owner(), w.admin);
    await reverse({ paymentId: a, reason: "wrong receipt", fiscalReceiptNo: "FR-REV-2" }, owner(), w.admin);
    const again = await expectAdvance(o);
    expect(again).not.toBe(a);
  });

  it("makes one expectation out of two requests at once", async () => {
    const o = await acceptedOrder(w);
    const [a, b] = await Promise.all([expectAdvance(o), expectAdvance(o)]);
    expect(a).toBe(b);
    const { rows } = await w.db.$client.query(
      "select count(*)::int as n from sales.payments where order_id = $1 and kind = 'fee_advance'",
      [o.orderId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("is a job of the owner in the admin role", async () => {
    const o = await acceptedOrder(w);
    await expect(
      expectPayment({ orderId: o.orderId, kind: "fee_advance" }, assistant(), w.admin),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(expectPayment({ orderId: o.orderId, kind: "fee_advance" }, owner(), w.bot)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      expectPayment({ orderId: o.orderId, kind: "fee_advance" }, customerActor(o), w.admin),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an unknown order, a bad id, an unknown kind and a fee for an order without a quote", async () => {
    await expect(
      expectPayment({ orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", kind: "fee_advance" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(expectPayment({ orderId: "x", kind: "fee_advance" }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const o = await acceptedOrder(w);
    await expect(
      expectPayment({ orderId: o.orderId, kind: "gift" as never, amountSum: 1 }, owner(), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("journals the expectation in the audit log", async () => {
    // Accepted through the site, which writes no payment: the expectation is the owner's here, from the admin panel.
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const accepted = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "site" },
      customerActor(o),
      w.web,
    );
    expect(accepted).toEqual({ ok: true, status: "accepted" });
    const id = await expectAdvance(o);
    const { rows } = await w.db.$client.query(
      "select actor, action, after from ops.audit_log where entity = 'sales.payments' and entity_id = $1",
      [id],
    );
    expect(rows).toEqual([
      {
        actor: `owner:${w.owner.id}`,
        action: "payment.expect",
        after: { orderId: o.orderId, kind: "fee_advance", amountSum: advanceOf(o) },
      },
    ]);
  });
});

describe("payments.expect after an acceptance through the bot", () => {
  it("finds the expectation the bot wrote with the function of the database and writes no second one", async () => {
    const o = await acceptedOrder(w); // the bot expected the advance and the money for the purchases itself
    const before = await w.db.$client.query("select id, kind from sales.payments where order_id = $1 order by kind", [
      o.orderId,
    ]);
    expect(before.rows.map((p) => p.kind)).toEqual(["fee_advance", "purchase_funds"]);
    const advance = await expectAdvance(o);
    const funds = await expectFunds(o);
    expect([advance, funds]).toEqual(before.rows.map((p) => p.id));
    const after = await w.db.$client.query("select count(*)::int as n from sales.payments where order_id = $1", [
      o.orderId,
    ]);
    expect(after.rows[0].n).toBe(2);
  });
});

describe("payments.confirm", () => {
  it("confirms a fee with the number of the receipt and stamps who and when, from the clock of the process", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    w.clock.advance(HOUR);
    const c = await confirm({ paymentId: id, fiscalReceiptNo: "FR-100" }, owner(), w.admin);
    expect(c).toMatchObject({ paymentId: id, kind: "fee_advance", amountSum: advanceOf(o) });
    const row = await paymentRow(id);
    expect(row.status).toBe("confirmed");
    expect(row.fiscal_receipt_no).toBe("FR-100");
    expect(row.confirmed_by).toBe(`owner:${w.owner.id}`);
    expect(row.confirmed_at).toEqual(w.clock.now());
    expect(row.payer_is_customer).toBe(true);
  });

  it("refuses a fee without a receipt with a readable message, and leaves the payment expected", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    for (const receipt of [undefined, "  "]) {
      await expect(
        confirm({ paymentId: id, ...(receipt === undefined ? {} : { fiscalReceiptNo: receipt }) }, owner(), w.admin),
      ).rejects.toMatchObject({ issues: [{ code: "receipt_required" }] });
    }
    expect((await paymentRow(id)).status).toBe("expected");
  });

  it("confirms purchase funds by the number of the bank document", async () => {
    const o = await acceptedOrder(w);
    const id = await expectFunds(o);
    await confirm({ paymentId: id, bankDocNo: "PP-77" }, owner(), w.admin);
    expect((await paymentRow(id)).bank_doc_no).toBe("PP-77");
  });

  it("does not confirm twice, nor a payment that was voided", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await confirm({ paymentId: id, fiscalReceiptNo: "FR-1" }, owner(), w.admin);
    await expect(confirm({ paymentId: id, fiscalReceiptNo: "FR-1" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "payment_not_expected" }],
    });
    const other = await expectFunds(o);
    await voidPayment({ paymentId: other, reason: "wrong account" }, owner(), w.admin);
    await expect(confirm({ paymentId: other, bankDocNo: "x" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "payment_not_expected" }],
    });
  });

  it("refuses a time that is not a time with a validation error, not with a RangeError of the driver", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    for (const at of [new Date("x"), "2026-10-12" as never, 0 as never]) {
      await expect(confirm({ paymentId: id, fiscalReceiptNo: "FR-3", at }, owner(), w.admin)).rejects.toMatchObject({
        name: "ValidationError",
        issues: [{ path: "at", code: "date_invalid" }],
      });
    }
    expect((await paymentRow(id)).status).toBe("expected");
  });

  it("answers the second of two confirmations at once with a refusal, and the first one stands", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    const results = await Promise.allSettled([
      confirm({ paymentId: id, fiscalReceiptNo: "FR-RACE-1", payerIsCustomer: true }, owner(), w.admin),
      confirm({ paymentId: id, fiscalReceiptNo: "FR-RACE-2", payerIsCustomer: true }, owner(), w.admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ name: "ValidationError", issues: [{ code: "payment_not_expected" }] });
  });

  it("refuses a time in the future and a payment that does not exist", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await expect(
      confirm(
        { paymentId: id, fiscalReceiptNo: "FR-2", at: new Date(w.clock.now().getTime() + DAY) },
        owner(),
        w.admin,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "at", code: "date_in_future" }] });
    await expect(
      confirm({ paymentId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", bankDocNo: "x" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("takes the money of a third party only with the written statement of that person", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await expect(
      confirm({ paymentId: id, fiscalReceiptNo: "FR-3", payerIsCustomer: false }, owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "thirdPartyStatementFileId", code: "statement_required" }] });
    await expect(
      confirm(
        {
          paymentId: id,
          fiscalReceiptNo: "FR-3",
          payerIsCustomer: false,
          thirdPartyStatementFileId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        },
        owner(),
        w.admin,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "thirdPartyStatementFileId", code: "file_unknown" }] });
    const statement = await newFile(w, { kind: "third_party_statement" });
    await confirm(
      { paymentId: id, fiscalReceiptNo: "FR-3", payerIsCustomer: false, thirdPartyStatementFileId: statement },
      owner(),
      w.admin,
    );
    const row = await paymentRow(id);
    expect([row.payer_is_customer, row.third_party_statement_file_id]).toEqual([false, statement]);
  });

  it("checks the file of the statement whenever it is named, also when the customer pays himself", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    for (const [thirdPartyStatementFileId, code] of [
      ["not-a-uuid", "uuid_invalid"],
      [7, "uuid_invalid"],
      ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "file_unknown"],
    ] as const) {
      await expect(
        confirm(
          {
            paymentId: id,
            fiscalReceiptNo: "FR-9",
            payerIsCustomer: true,
            thirdPartyStatementFileId: thirdPartyStatementFileId as never,
          },
          owner(),
          w.admin,
        ),
      ).rejects.toMatchObject({ name: "ValidationError", issues: [{ path: "thirdPartyStatementFileId", code }] });
    }
    expect((await paymentRow(id)).status).toBe("expected");
  });

  it("is for the owner in the admin role only: the assistant does not confirm money", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await expect(confirm({ paymentId: id, fiscalReceiptNo: "FR-4" }, assistant(), w.admin)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(confirm({ paymentId: id, fiscalReceiptNo: "FR-4" }, owner(), w.bot)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("queues the check of the threshold, once per payment", async () => {
    const o = await acceptedOrder(w);
    const id = await expectFunds(o);
    await confirm({ paymentId: id, bankDocNo: "PP-1" }, owner(), w.admin);
    const { rows } = await w.db.$client.query("select kind, payload from ops.outbox where dedupe_key = $1", [
      `payment:${id}:threshold`,
    ]);
    expect(rows).toEqual([{ kind: "job", payload: { job: "threshold.check", orderId: o.orderId, paymentId: id } }]);
  });
});

describe("payments.void", () => {
  it("voids an expected payment with a reason that goes to the audit log", async () => {
    const o = await acceptedOrder(w);
    const id = await expectFunds(o);
    await voidPayment({ paymentId: id, reason: "wrong amount in the QR" }, owner(), w.admin);
    expect((await paymentRow(id)).status).toBe("void");
    const { rows } = await w.db.$client.query(
      "select actor, action, after from ops.audit_log where entity = 'sales.payments' and entity_id = $1 and action = 'payment.void'",
      [id],
    );
    expect(rows).toEqual([
      { actor: `owner:${w.owner.id}`, action: "payment.void", after: { reason: "wrong amount in the QR" } },
    ]);
  });

  it("needs a reason, refuses a confirmed payment and a payment that does not exist", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await expect(voidPayment({ paymentId: id, reason: "  " }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await confirm({ paymentId: id, fiscalReceiptNo: "FR-5" }, owner(), w.admin);
    await expect(voidPayment({ paymentId: id, reason: "oops" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "payment_not_expected" }],
    });
    await expect(
      voidPayment({ paymentId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", reason: "x" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("payments.reverse", () => {
  it("corrects a confirmed payment with a row of the negative amount and journals the reason", async () => {
    const o = await acceptedOrder(w);
    const id = await expectFunds(o);
    await confirm({ paymentId: id, bankDocNo: "PP-9" }, owner(), w.admin);
    const r = await reverse({ paymentId: id, reason: "returned by the bank", bankDocNo: "PP-9R" }, owner(), w.admin);
    const row = await paymentRow(r.reversalId);
    expect([row.amount_sum, row.reversal_of, row.status]).toEqual([String(-limitOf(o)), id, "confirmed"]);
    const sums = await w.db.$client.query(
      "select coalesce(sum(amount_sum), 0)::text as net from sales.payments where order_id = $1 and kind = 'purchase_funds' and status = 'confirmed'",
      [o.orderId],
    );
    expect(sums.rows[0].net).toBe("0");
  });

  it("needs the receipt of the correction for a fee, and does not reverse more than was paid", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await confirm({ paymentId: id, fiscalReceiptNo: "FR-6" }, owner(), w.admin);
    await expect(reverse({ paymentId: id, reason: "refund of the fee" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "receipt_required" }],
    });
    await reverse(
      { paymentId: id, reason: "refund of a part", amountSum: 100, fiscalReceiptNo: "FR-6R" },
      owner(),
      w.admin,
    );
    await expect(
      reverse(
        { paymentId: id, reason: "too much", amountSum: advanceOf(o), fiscalReceiptNo: "FR-6R2" },
        owner(),
        w.admin,
      ),
    ).rejects.toMatchObject({ issues: [{ code: "invalid_reversal" }] });
  });

  it("refuses a payment that is not confirmed", async () => {
    const o = await acceptedOrder(w);
    const id = await expectFunds(o);
    await expect(reverse({ paymentId: id, reason: "x" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "payment_not_confirmed" }],
    });
  });
});

describe("the money events of the order", () => {
  beforeEach(() => w.clock.set(new Date("2026-10-12T10:00:00+05:00")));

  async function paid(o: TestOrder, opts: { receivedAt?: Date } = {}) {
    const advance = await expectAdvance(o);
    const funds = await expectFunds(o);
    await confirm({ paymentId: advance, fiscalReceiptNo: `FR-${advance.slice(-6)}` }, owner(), w.admin);
    await confirm({ paymentId: funds, bankDocNo: `PP-${funds.slice(-6)}` }, owner(), w.admin);
    return { advance, funds, receivedAt: opts.receivedAt ?? w.clock.now() };
  }

  it("FEE_PREPAID: opens the flag when the confirmed advance is the advance of the quote", async () => {
    const o = await acceptedOrder(w);
    const { advance } = await paid(o);
    expect(await dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: advance }, owner(), w.admin)).toEqual({
      ok: true,
      status: "accepted",
    });
    const { rows } = await w.db.$client.query("select fee_prepaid from sales.orders where id = $1", [o.orderId]);
    expect(rows[0].fee_prepaid).toBe(true);
  });

  it("FEE_PREPAID: refuses a payment that is not confirmed, not the advance, not through the QR, not of this order", async () => {
    const o = await acceptedOrder(w);
    const other = await acceptedOrder(w);
    const pending = await expectAdvance(o);
    const run = (paymentId: string) => dispatch(o.orderId, { type: "FEE_PREPAID", paymentId }, owner(), w.admin);
    expect(await run(pending)).toEqual({ ok: false, error: "payments_incomplete" }); // expected, not confirmed
    expect(await run("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toEqual({ ok: false, error: "payments_incomplete" });
    expect(await run("not-a-uuid")).toEqual({ ok: false, error: "payments_incomplete" });
    const extra = (
      await expectPayment({ orderId: o.orderId, kind: "fee_extra", amountSum: advanceOf(o) }, owner(), w.admin)
    ).paymentId;
    await confirm({ paymentId: extra, fiscalReceiptNo: "FR-X" }, owner(), w.admin);
    expect(await run(extra)).toEqual({ ok: false, error: "payments_incomplete" }); // a fee, but not the advance
    const foreign = await expectAdvance(other);
    await confirm({ paymentId: foreign, fiscalReceiptNo: "FR-F" }, owner(), w.admin);
    expect(await run(foreign)).toEqual({ ok: false, error: "payments_incomplete" }); // the advance of another order
  });

  it("FEE_PREPAID: a reversed advance is no longer the advance", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    await confirm({ paymentId: id, fiscalReceiptNo: "FR-R1" }, owner(), w.admin);
    await reverse({ paymentId: id, reason: "refund", amountSum: 1, fiscalReceiptNo: "FR-R1R" }, owner(), w.admin);
    expect(await dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: id }, owner(), w.admin)).toEqual({
      ok: false,
      error: "payments_incomplete",
    });
  });

  it("FEE_PREPAID: the payment of a third party counts only with the statement", async () => {
    const o = await acceptedOrder(w);
    const id = await expectAdvance(o);
    // The database lets the owner confirm a fee paid by another person only with a statement (here: attach it).
    const statement = await newFile(w, { kind: "third_party_statement" });
    await confirm(
      { paymentId: id, fiscalReceiptNo: "FR-T", payerIsCustomer: false, thirdPartyStatementFileId: statement },
      owner(),
      w.admin,
    );
    expect(await dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: id }, owner(), w.admin)).toEqual({
      ok: true,
      status: "accepted",
    });
  });

  it("FEE_PREPAID is not repeatable by the automaton itself, and a retry of the same call is recognised", async () => {
    const o = await acceptedOrder(w);
    const { advance } = await paid(o);
    const event = { type: "FEE_PREPAID", paymentId: advance } as const;
    expect((await dispatch(o.orderId, event, owner(), w.admin)).ok).toBe(true);
    const evBefore = (
      await w.db.$client.query("select count(*)::int as n from sales.order_events where order_id = $1", [o.orderId])
    ).rows[0].n;
    expect(await dispatch(o.orderId, event, owner(), w.admin)).toEqual({ ok: true, status: "accepted" });
    const evAfter = (
      await w.db.$client.query("select count(*)::int as n from sales.order_events where order_id = $1", [o.orderId])
    ).rows[0].n;
    expect(evAfter).toBe(evBefore);
    // The same payment named by another owner is not a retry: the flag is already up.
    expect(await dispatch(o.orderId, event, { kind: "owner", id: w.assistant.id }, w.admin)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("FUNDS_RECEIVED: opens the flag with the full amount of the limit and sets the day from which the purchase may start", async () => {
    const o = await acceptedOrder(w);
    const { funds, receivedAt } = await paid(o);
    const r = await dispatch(o.orderId, { type: "FUNDS_RECEIVED", paymentIds: [funds], receivedAt }, owner(), w.admin);
    expect(r).toEqual({ ok: true, status: "accepted" });
    const { rows } = await w.db.$client.query(
      "select funds_received, funds_received_at, purchase_not_before from sales.orders where id = $1",
      [o.orderId],
    );
    expect(rows[0].funds_received).toBe(true);
    expect(rows[0].funds_received_at).toEqual(receivedAt);
    // Money on Monday 10:00: purchases from Tuesday 10:00 in Tashkent (the next working day).
    expect(rows[0].purchase_not_before).toEqual(new Date("2026-10-13T10:00:00+05:00"));
  });

  it("FUNDS_RECEIVED: refuses less than the limit, a time in the future, the QR as a way, and another order's funds", async () => {
    const o = await acceptedOrder(w);
    const other = await acceptedOrder(w);
    const funds = await expectFunds(o);
    const partial = (
      await expectPayment({ orderId: o.orderId, kind: "purchase_topup", amountSum: 1_000_000 }, owner(), w.admin)
    ).paymentId;
    await confirm({ paymentId: partial, bankDocNo: "PP-P" }, owner(), w.admin);
    const run = (ids: string[], receivedAt = w.clock.now()) =>
      dispatch(o.orderId, { type: "FUNDS_RECEIVED", paymentIds: ids, receivedAt }, owner(), w.admin);
    expect(await run([partial])).toEqual({ ok: false, error: "payments_incomplete" }); // less than the limit
    expect(await run([funds])).toEqual({ ok: false, error: "payments_incomplete" }); // not confirmed yet
    await confirm({ paymentId: funds, bankDocNo: "PP-F" }, owner(), w.admin);
    expect(await run([funds], new Date(w.clock.now().getTime() + HOUR))).toEqual({
      ok: false,
      error: "payments_incomplete",
    });
    expect(await run([])).toEqual({ ok: false, error: "payments_incomplete" });
    const foreign = await expectFunds(other);
    await confirm({ paymentId: foreign, bankDocNo: "PP-O" }, owner(), w.admin);
    expect(await run([foreign])).toEqual({ ok: false, error: "payments_incomplete" });
    expect(await run([funds])).toEqual({ ok: true, status: "accepted" });
  });

  it("START_PURCHASE: waits for both flags and for the next working day, then lets the purchase begin", async () => {
    const o = await acceptedOrder(w);
    const { advance, funds, receivedAt } = await paid(o);
    const start = () => dispatch(o.orderId, { type: "START_PURCHASE" }, owner(), w.admin);
    expect(await start()).toEqual({ ok: false, error: "payments_incomplete" });
    await dispatch(o.orderId, { type: "FEE_PREPAID", paymentId: advance }, owner(), w.admin);
    expect(await start()).toEqual({ ok: false, error: "payments_incomplete" });
    await dispatch(o.orderId, { type: "FUNDS_RECEIVED", paymentIds: [funds], receivedAt }, owner(), w.admin);
    expect(await start()).toEqual({ ok: false, error: "purchase_too_early" });
    w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
    expect(await start()).toEqual({ ok: true, status: "purchasing" });
  });
});

async function podborOrder(): Promise<{ orderId: string; customerId: string; fee: number }> {
  const lead = await createLead(
    { channel: "bot", scope: "podbor", customer: { telegramUserId: 7_600_000_000 + Math.floor(Math.random() * 1e6) } },
    w.bot,
  );
  const order = await convert({ leadId: lead.leadId }, owner(), w.admin);
  const quote = await build({ orderId: order.orderId, lines: pcLines(w), tasks: ["gaming"] }, owner(), w.admin);
  const sent = await send({ orderId: order.orderId, quoteId: quote.quoteId }, owner(), w.admin);
  expect(sent.ok).toBe(true);
  const settings = await loadFeeSettings(w.db);
  return { orderId: order.orderId, customerId: lead.customerId as string, fee: podborFee(quote.totals.fee, settings) };
}

describe("the Podbor fee", () => {
  it("is expected in the amount the domain counts from the fee of the quote, and a caller's sum is not taken", async () => {
    const o = await podborOrder();
    expect(o.fee).toBeGreaterThan(0);
    const a = await expectPayment({ orderId: o.orderId, kind: "podbor_fee" }, owner(), w.admin);
    expect((await paymentRow(a.paymentId)).amount_sum).toBe(String(o.fee));
    await expect(
      expectPayment({ orderId: o.orderId, kind: "podbor_fee", amountSum: 1000 }, owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "amountSum", code: "amount_mismatch" }] });
    expect(
      (await expectPayment({ orderId: o.orderId, kind: "podbor_fee", amountSum: o.fee }, owner(), w.admin)).paymentId,
    ).toBe(a.paymentId);
  });

  it("PODBOR_DELIVERED takes only a fee paid in full: a part of it does not deliver the Podbor", async () => {
    const o = await podborOrder();
    const { paymentId } = await expectPayment({ orderId: o.orderId, kind: "podbor_fee" }, owner(), w.admin);
    await confirm({ paymentId, fiscalReceiptNo: "FR-PODBOR-1", payerIsCustomer: true }, owner(), w.admin);
    await reverse(
      { paymentId, reason: "returned in part", amountSum: Math.floor(o.fee / 2), fiscalReceiptNo: "FR-PODBOR-2" },
      owner(),
      w.admin,
    );
    expect(await dispatch(o.orderId, { type: "PODBOR_DELIVERED", paymentId }, owner(), w.admin)).toEqual({
      ok: false,
      error: "payments_incomplete",
    });
  });

  it("PODBOR_DELIVERED passes with the fee paid in full", async () => {
    const o = await podborOrder();
    const { paymentId } = await expectPayment({ orderId: o.orderId, kind: "podbor_fee" }, owner(), w.admin);
    await confirm({ paymentId, fiscalReceiptNo: "FR-PODBOR-3", payerIsCustomer: true }, owner(), w.admin);
    expect(await dispatch(o.orderId, { type: "PODBOR_DELIVERED", paymentId }, owner(), w.admin)).toEqual({
      ok: true,
      status: "podbor_delivered",
    });
  });
});
