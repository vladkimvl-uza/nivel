// The acceptance scenario of WP-07 on a real database with a fake clock: request -> estimate -> acceptance -> 30 % ->
// money -> purchase -> report -> refund -> act -> 70 % -> closing. Each step names what the table 4.9 demands.
import { buildPassports } from "@nivel/db";
import type { OrderEvent } from "@nivel/domain/order";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate as generateAct, sign as signAct } from "../acts/index.ts";
import { record as recordConsent } from "../consents/index.ts";
import { convert, create as createLead } from "../leads/index.ts";
import { confirm, expect as expectPayment, reverse } from "../payments/index.ts";
import { record as recordPurchase } from "../purchases/index.ts";
import { build } from "../quotes/build.ts";
import { send as sendQuote } from "../quotes/send.ts";
import { accept as acceptReport, generate as generateReport, send as sendReport } from "../reports/index.ts";
import { dispatch } from "./dispatch.ts";
import { createWorld, DAY, newFile, PC_CATALOG, PC_COMPONENTS_SUM, pcLines, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const sql = async <T = Record<string, unknown>>(text: string, args: unknown[] = []) =>
  (await w.db.$client.query(text, args)).rows as T[];

describe("the whole life of an order", () => {
  it("goes from a request to a closed order, every step by the right actor, every repeat harmless", async () => {
    const owner = { kind: "owner" as const, id: w.owner.id };
    const assistant = { kind: "assistant" as const, id: w.assistant.id };
    const system = { kind: "system" as const, id: "system" };

    // ---- 1. a request of the customer in the bot -> a lead L- -> an order NV- --------------------------------------
    w.clock.set(new Date("2026-10-12T10:00:00+05:00")); // Monday
    const lead = await createLead(
      {
        channel: "bot",
        scope: "pc",
        district: "Chilonzor",
        budgetSum: 15_000_000,
        customer: { telegramUserId: 7_900_000_001, displayName: "Aziz" },
      },
      w.bot,
    );
    expect(lead.number).toMatch(/^L-2026-\d{4}$/);
    const order = await convert({ leadId: lead.leadId }, owner, w.admin);
    expect(order.number).toMatch(/^NV-2026-\d{4}$/);
    const orderId = order.orderId;
    const customer = { kind: "customer" as const, id: lead.customerId };

    const status = async () =>
      (await sql<{ status: string }>("select status from sales.orders where id = $1", [orderId]))[0]?.status;
    const counts = async () => ({
      events: (
        await sql<{ n: number }>("select count(*)::int as n from sales.order_events where order_id = $1", [orderId])
      )[0]?.n,
      outbox: (
        await sql<{ n: number }>("select count(*)::int as n from ops.outbox where payload->>'orderId' = $1", [orderId])
      )[0]?.n,
      payments: (
        await sql<{ n: number }>("select count(*)::int as n from sales.payments where order_id = $1", [orderId])
      )[0]?.n,
    });
    /** The same event again: the answer is the same and nothing is written twice. */
    const again = async (event: OrderEvent, actor: typeof owner | typeof customer | typeof system, rt = w.admin) => {
      const before = await counts();
      const r = await dispatch(orderId, event, actor, rt);
      expect(r.ok).toBe(true);
      expect(await counts()).toEqual(before);
    };
    const refused = async (
      event: OrderEvent,
      actor: { kind: "owner" | "assistant" | "customer" | "system"; id: string },
      error: string,
      rt = w.admin,
    ) => {
      const before = await counts();
      expect(await dispatch(orderId, event, actor, rt)).toEqual({ ok: false, error });
      expect(await counts()).toEqual(before);
    };

    // ---- 2. the estimate: calculated by the server, checked by the owner, valid for 24 hours -----------------------
    const quote = await build({ orderId, lines: pcLines(w), tasks: ["gaming"] }, owner, w.admin);
    await refused(
      { type: "SEND_ESTIMATE", quoteId: quote.quoteId, manuallyChecked: true },
      assistant,
      "actor_not_allowed",
    );
    expect(await sendQuote({ orderId, quoteId: quote.quoteId }, assistant, w.admin)).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
    expect(await sendQuote({ orderId, quoteId: quote.quoteId }, owner, w.admin)).toEqual({
      ok: true,
      status: "estimate_sent",
    });
    expect(await sendQuote({ orderId, quoteId: quote.quoteId }, owner, w.admin)).toEqual({
      ok: true,
      status: "estimate_sent",
    });
    const t = quote.totals;
    expect(t.componentsSum).toBe(PC_COMPONENTS_SUM);
    expect(t.advance + t.final).toBe(t.fee.total);

    // ---- 3. the acceptance: consents, the offer and the estimate -------------------------------------------------------
    w.clock.advance(2 * 3_600_000);
    const consents = [
      (
        await recordConsent(
          { kind: "pd_processing", customerId: lead.customerId, granted: true, channel: "bot" },
          w.bot,
        )
      ).id,
      (
        await recordConsent(
          { kind: "supplier_data_transfer", customerId: lead.customerId, orderId, granted: true, channel: "bot" },
          w.bot,
        )
      ).id,
      (
        await recordConsent(
          { kind: "non_returnable", customerId: lead.customerId, orderId, granted: true, channel: "bot" },
          w.bot,
        )
      ).id,
    ];
    const accept: OrderEvent = { type: "ACCEPT", quoteId: quote.quoteId, consentIds: consents, channel: "bot" };
    expect(await dispatch(orderId, accept, customer, w.bot)).toEqual({ ok: true, status: "accepted" });
    await again(accept, customer, w.bot);

    // ---- 4. 30 %: the advance by the QR with the receipt of the cash register ---------------------------------------------
    const advance = (await expectPayment({ orderId, kind: "fee_advance" }, owner, w.admin)).paymentId;
    const funds = (await expectPayment({ orderId, kind: "purchase_funds" }, owner, w.admin)).paymentId;
    expect(
      (await sql<{ amount_sum: string }>("select amount_sum from sales.payments where id = $1", [advance]))[0]
        ?.amount_sum,
    ).toBe(String(t.advance));
    await refused({ type: "FEE_PREPAID", paymentId: advance }, assistant, "actor_not_allowed");
    await refused({ type: "FEE_PREPAID", paymentId: advance }, owner, "payments_incomplete"); // not confirmed yet
    await confirm({ paymentId: advance, fiscalReceiptNo: "FR-2026-0001" }, owner, w.admin);
    expect(await dispatch(orderId, { type: "FEE_PREPAID", paymentId: advance }, owner, w.admin)).toEqual({
      ok: true,
      status: "accepted",
    });
    await again({ type: "FEE_PREPAID", paymentId: advance }, owner);

    // ---- 5. the money for purchases: by transfer to the account of the sole proprietor --------------------------------------
    await confirm({ paymentId: funds, bankDocNo: "PP-2026-0001" }, owner, w.admin);
    const receivedAt = w.clock.now();
    const fundsEvent: OrderEvent = { type: "FUNDS_RECEIVED", paymentIds: [funds], receivedAt };
    await refused(fundsEvent, assistant, "actor_not_allowed");
    expect(await dispatch(orderId, fundsEvent, owner, w.admin)).toEqual({ ok: true, status: "accepted" });
    await again(fundsEvent, owner);
    await refused({ type: "START_PURCHASE" }, assistant, "actor_not_allowed");
    await refused({ type: "START_PURCHASE" }, owner, "purchase_too_early"); // the money came on Monday: purchases from Tuesday 10:00
    w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
    expect(await dispatch(orderId, { type: "START_PURCHASE" }, owner, w.admin)).toEqual({
      ok: true,
      status: "purchasing",
    });

    // ---- 6. the purchase: a receipt and its photo for every position; the assistant may record ---------------------------
    const lines = await sql<{ id: string; product_id: string }>(
      "select id, product_id from sales.quote_lines where quote_id = $1",
      [quote.quoteId],
    );
    for (const [i, p] of PC_CATALOG.entries()) {
      const line = lines.find((l) => l.product_id === w.products[p.key].id);
      const r = await recordPurchase(
        {
          orderId,
          vendorId: w.vendorId,
          quoteLineId: line?.id as string,
          productId: w.products[p.key].id,
          qty: 1,
          amountSum: p.price,
          paidVia: "bank_transfer",
          receiptKind: "fiscal",
          receiptNo: `CH-9${i}`,
          receiptFileIds: [await newFile(w)],
        },
        i % 2 === 0 ? owner : assistant,
        w.admin,
      );
      expect(r.ok).toBe(true);
    }
    await refused({ type: "PURCHASE_DONE" }, assistant, "actor_not_allowed");
    expect(await dispatch(orderId, { type: "PURCHASE_DONE" }, owner, w.admin)).toEqual({
      ok: true,
      status: "report_due",
    });
    await again({ type: "PURCHASE_DONE" }, owner);

    // ---- 7. the report of the commission and the refund of the remainder ------------------------------------------------
    w.clock.advance(20 * 3_600_000);
    const report = await generateReport({ orderId }, owner, w.admin);
    expect(report.remainderSum).toBe(t.purchaseLimit - PC_COMPONENTS_SUM);
    expect(await sendReport({ orderId, reportId: report.reportId }, owner, w.admin)).toEqual({
      ok: true,
      status: "report_sent",
    });
    expect(await acceptReport({ orderId }, customer, w.bot)).toEqual({ ok: true, status: "report_sent" });
    const refund = (
      await sql<{ id: string; amount_sum: string }>(
        "select id, amount_sum from sales.payments where order_id = $1 and kind = 'remainder_refund'",
        [orderId],
      )
    )[0];
    if (!refund) throw new Error("the remainder refund was not expected");
    expect(refund.amount_sum).toBe(String(report.remainderSum));
    await refused({ type: "REMAINDER_SETTLED", refundPaymentId: refund.id }, assistant, "actor_not_allowed");
    await refused({ type: "REMAINDER_SETTLED", refundPaymentId: refund.id }, owner, "not_reconciled"); // the money has not gone back
    await confirm({ paymentId: refund.id, bankDocNo: "PP-2026-0002" }, owner, w.admin);
    expect(await dispatch(orderId, { type: "REMAINDER_SETTLED", refundPaymentId: refund.id }, owner, w.admin)).toEqual({
      ok: true,
      status: "settled",
    });
    const reserve = await sql<{ fund: string; amount: number }>(
      "select fund, amount_sum::int as amount from sales.reserve_ledger where order_id = $1",
      [orderId],
    );
    expect(reserve).toEqual([{ fund: "tax_risk", amount: Math.ceil(PC_COMPONENTS_SUM / 100) }]);

    // ---- 8. the act of acceptance of the materials, the assembly and the tests ---------------------------------------------
    const materialsAct = await generateAct(
      { orderId, kind: "material_acceptance", lines: [{ title: "Keyboard of the customer", qty: 1, serial: "KB-77" }] },
      owner,
      w.admin,
    );
    await refused({ type: "MATERIALS_ACCEPTED", actId: materialsAct.actId }, owner, "act_missing"); // not signed
    await signAct({ actId: materialsAct.actId, via: "tg_button", evidence: { messageId: 100 } }, customer, w.admin);
    expect(await dispatch(orderId, { type: "MATERIALS_ACCEPTED", actId: materialsAct.actId }, owner, w.admin)).toEqual({
      ok: true,
      status: "assembling",
    });
    expect(await dispatch(orderId, { type: "ASSEMBLED" }, assistant, w.admin)).toEqual({ ok: true, status: "testing" });
    await refused({ type: "TESTS_PASSED", passportId: orderId }, assistant, "passport_missing"); // no passport yet
    await w.db.insert(buildPassports).values({ orderId, tests: { tool: "OCCT", minutes: 420, errors: 0 } });
    expect(await dispatch(orderId, { type: "TESTS_PASSED", passportId: orderId }, assistant, w.admin)).toEqual({
      ok: true,
      status: "ready",
    });

    // ---- 9. the handover: 70 % of the fee by the QR with a receipt, the act, the warranty ----------------------------------
    await refused({ type: "DISPATCH" }, assistant, "actor_not_allowed");
    expect(await dispatch(orderId, { type: "DISPATCH" }, owner, w.admin)).toEqual({ ok: true, status: "delivering" });
    const finalPayment = (
      await sql<{ id: string; amount_sum: string; status: string }>(
        "select id, amount_sum, status from sales.payments where order_id = $1 and kind = 'fee_final'",
        [orderId],
      )
    )[0];
    expect(finalPayment).toMatchObject({ amount_sum: String(t.final), status: "expected" }); // expected from the moment of DISPATCH
    const handoverAct = await generateAct({ orderId, kind: "handover" }, owner, w.admin);
    const handover: OrderEvent = {
      type: "HANDOVER",
      actId: handoverAct.actId,
      finalPaymentId: finalPayment?.id as string,
    };
    await refused(handover, assistant, "actor_not_allowed");
    await refused(handover, owner, "final_payment_missing"); // the 70 % have not been paid
    await confirm({ paymentId: finalPayment?.id as string, fiscalReceiptNo: "FR-2026-0002" }, owner, w.admin);
    // The customer presses "Qabul qildim": an event of the customer through the bot.
    await signAct({ actId: handoverAct.actId, via: "tg_button" }, customer, w.admin);
    expect(await dispatch(orderId, handover, customer, w.bot)).toEqual({ ok: true, status: "handed_over" });
    await again(handover, customer, w.bot);
    const delivered = (
      await sql<{ warranty_until: Date; handed_over_at: Date }>(
        "select warranty_until, handed_over_at from sales.orders where id = $1",
        [orderId],
      )
    )[0];
    expect(delivered?.handed_over_at).toEqual(w.clock.now());
    // Twelve months of warranty by the calendar of Tashkent.
    expect(delivered?.warranty_until).toEqual(new Date("2027-10-14T06:00:00+05:00"));
    const aftercare = await sql<{ at: string }>(
      "select payload->>'at' as at from ops.outbox where payload->>'orderId' = $1 and payload->>'job' = 'aftercare' order by 1",
      [orderId],
    );
    expect(aftercare.map((a) => a.at)).toEqual([
      new Date(w.clock.now().getTime() + 7 * DAY).toISOString(),
      new Date(w.clock.now().getTime() + 30 * DAY).toISOString(),
    ]);
    // The bot cannot read or write the ledger of the warranty fund: the entry travels to the worker (2 % of the components, 150 000 at least).
    const ledgerJob = await sql<{ payload: { fund: string; amountSum: number } }>(
      "select payload from ops.outbox where payload->>'orderId' = $1 and payload->>'job' = 'ledger.append'",
      [orderId],
    );
    expect(ledgerJob.map((j) => [j.payload.fund, j.payload.amountSum])).toEqual([
      ["warranty", Math.ceil(PC_COMPONENTS_SUM / 50)],
    ]);

    // ---- 10. closing: only when the money is reconciled -----------------------------------------------------------------------
    await refused({ type: "CLOSE" }, owner, "actor_not_allowed"); // the closing is made by the system, not by a person
    // The bank returns the refund of the remainder: the customer has less back than the books say.
    await reverse({ paymentId: refund.id, reason: "the bank returned the transfer" }, owner, w.admin);
    await refused({ type: "CLOSE" }, system, "not_reconciled", w.worker);
    const reRefund = (
      await expectPayment({ orderId, kind: "funds_refund", amountSum: report.remainderSum }, owner, w.admin)
    ).paymentId;
    await confirm({ paymentId: reRefund, bankDocNo: "PP-2026-0003" }, owner, w.admin);
    expect(await dispatch(orderId, { type: "CLOSE" }, system, w.worker)).toEqual({ ok: true, status: "closed" });
    await again({ type: "CLOSE" }, system, w.worker);

    // ---- the record ----------------------------------------------------------------------------------------------------------------
    const journal = await sql<{ seq: number; type: string; actor_kind: string; to_status: string }>(
      "select seq, event->>'type' as type, actor_kind, to_status from sales.order_events where order_id = $1 order by seq",
      [orderId],
    );
    expect(journal.map((e) => e.seq)).toEqual(journal.map((_, i) => i + 1)); // numbers one after another
    expect(journal.map((e) => e.type)).toEqual([
      "SEND_ESTIMATE",
      "ACCEPT",
      "FEE_PREPAID",
      "FUNDS_RECEIVED",
      "START_PURCHASE",
      ...PC_CATALOG.map(() => "PURCHASE_RECORDED"),
      "PURCHASE_DONE",
      "SEND_REPORT",
      "REPORT_ACCEPTED",
      "REMAINDER_SETTLED",
      "MATERIALS_ACCEPTED",
      "ASSEMBLED",
      "TESTS_PASSED",
      "DISPATCH",
      "HANDOVER",
      "CLOSE",
    ]);
    expect(journal.at(-1)).toMatchObject({ to_status: "closed", actor_kind: "system" });
    expect(await status()).toBe("closed");

    // Every step of the status is in the audit log with the role of the database that made it.
    const audit = await sql<{ n: number; roles: string[] }>(
      "select count(*)::int as n, array_agg(distinct after->>'db_role') as roles from ops.audit_log where entity = 'sales.orders' and entity_id = $1",
      [orderId],
    );
    expect(audit[0]?.n).toBe(journal.length);
    expect([...(audit[0]?.roles ?? [])].sort()).toEqual(["nivel_admin", "nivel_bot", "nivel_worker"]);

    // The books agree: the money received equals the purchases, the refunds and the losses (the database checks it at `closed` too).
    const books = await sql<{ funds: string; spent: string; refunded: string }>(
      `select
         (select coalesce(sum(amount_sum), 0) from sales.payments where order_id = $1 and status = 'confirmed' and kind in ('purchase_funds', 'purchase_topup'))::text as funds,
         (select coalesce(sum(amount_sum), 0) from sales.purchases where order_id = $1)::text as spent,
         (select coalesce(sum(amount_sum), 0) from sales.payments where order_id = $1 and status = 'confirmed' and kind in ('remainder_refund', 'funds_refund'))::text as refunded`,
      [orderId],
    );
    expect(Number(books[0]?.funds)).toBe(Number(books[0]?.spent) + Number(books[0]?.refunded));
  }, 240_000);
});
