import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import type { DbRuleError } from "./errors.ts";
import { enqueueOutbox, recordConsent } from "./ops.ts";
import {
  addOtherIncome,
  appendReserve,
  applyTransition,
  confirmPayment,
  createCustomer,
  createLead,
  createOrder,
  dealVolume,
  expectPayment,
  findCustomerByTelegramId,
  getConfigurationByCode,
  getOrder,
  getOrderByNumber,
  getQuote,
  insertQuoteDraft,
  latestQuoteOfOrder,
  listOrderEvents,
  listOrdersByStatus,
  listPayments,
  listPurchases,
  loadOrderContext,
  markQuoteAccepted,
  markQuoteSent,
  newPublicCode,
  orderMoney,
  recordPurchase,
  reserveBalance,
  returnPurchase,
  reversePayment,
  saveConfiguration,
  setLeadStatus,
  setQuoteStatus,
  tashkentYear,
  voidPayment,
} from "./sales.ts";
import { connectAs, createVendor, openDb, uniq } from "./testkit.ts";

let owner: Db;
let vendorId: string;
let adminUserId: string;

beforeAll(async () => {
  owner = openDb("ADMIN");
  const m = await connectAs("MIGRATOR");
  try {
    vendorId = await createVendor(m);
    const u = await m.query<{ id: string }>(
      "insert into ops.admin_users (email, password_hash, role) values ($1, 'x', 'owner') returning id",
      [`sales${uniq()}@example.test`],
    );
    adminUserId = u.rows[0]?.id as string;
  } finally {
    await m.end();
  }
});
afterAll(async () => {
  await owner.$client.end();
});

const feeTotal = 3_240_000;
const advance = 972_000;
const limit = 20_000_000;

async function draftOrder() {
  const customerId = await createCustomer(owner, {
    displayName: `Client ${uniq()}`,
    telegramUserId: 9_000_000_000 + uniq(),
    lang: "uz",
  });
  const order = await createOrder(owner, { customerId, kind: "pc", now: new Date("2026-10-06T08:00:00Z") });
  const quoteId = await insertQuoteDraft(
    owner,
    {
      orderId: order.id,
      version: 1,
      totals: { grandTotal: limit + feeTotal },
      componentsSum: 19_000_000,
      reserveBp: 500,
      reserveSum: 1_000_000,
      purchaseLimit: limit,
      feeTotal,
      feeCommissionLine: 1_620_000,
      feeWorksLine: 1_620_000,
      feeAdvance: advance,
      feeFinal: feeTotal - advance,
      outsideScaleSum: 0,
      settingsVersion: "2026-10-05",
    },
    [
      {
        titleSnapshot: "AMD Ryzen 7 9700X",
        categoryCode: "cpu",
        feeGroup: "pc",
        qty: 1,
        unitMarketSum: 2_590_000,
        returnable: "yes",
        purchasedByIp: true,
      },
      {
        titleSnapshot: "RTX 5070",
        categoryCode: "gpu",
        feeGroup: "pc",
        qty: 1,
        unitMarketSum: 8_880_000,
        confidence: "low",
        returnable: "yes",
        purchasedByIp: true,
      },
    ],
  );
  return { customerId, orderId: order.id, number: order.number, quoteId };
}

describe("numbers and the entry of a request", () => {
  it("takes the business year in Tashkent time", () => {
    expect(tashkentYear(new Date("2026-12-31T18:59:59Z"))).toBe(2026);
    expect(tashkentYear(new Date("2026-12-31T19:00:00Z"))).toBe(2027);
  });

  it("creates leads and orders with consecutive public numbers", async () => {
    const customerId = await createCustomer(owner, { displayName: "A", telegramUserId: 9_100_000_000 + uniq() });
    const a = await createLead(owner, {
      customerId,
      channel: "bot",
      scope: "pc",
      now: new Date("2031-05-01T10:00:00Z"),
    });
    const b = await createLead(owner, {
      customerId,
      channel: "web",
      scope: "setup",
      now: new Date("2031-05-02T10:00:00Z"),
    });
    expect([a.number, b.number]).toEqual(["L-2031-0001", "L-2031-0002"]);
    const o = await createOrder(owner, { customerId, kind: "pc", leadId: a.id, now: new Date("2031-05-03T10:00:00Z") });
    expect(o.number).toBe("NV-2031-0001");
    expect((await getOrderByNumber(owner, o.number))?.id).toBe(o.id);
    expect((await getOrder(owner, o.id))?.status).toBe("estimate_draft");
    expect(await getOrder(owner, "00000000-0000-7000-8000-000000000000")).toBeNull();
  });

  it("refuses a rejected lead without a reason and accepts it with one", async () => {
    const lead = await createLead(owner, { channel: "web", scope: "pc" });
    await expect(setLeadStatus(owner, lead.id, "rejected")).rejects.toMatchObject({
      code: "check_violation",
      constraint: "leads_reject_chk",
    });
    await setLeadStatus(owner, lead.id, "rejected", "below_minimum");
    await setLeadStatus(owner, (await createLead(owner, { channel: "web", scope: "pc" })).id, "in_review");
  });

  it("finds a customer by Telegram id and refuses a duplicate", async () => {
    const tg = 9_200_000_000 + uniq();
    const id = await createCustomer(owner, { displayName: "TG", telegramUserId: tg });
    expect((await findCustomerByTelegramId(owner, tg))?.id).toBe(id);
    expect(await findCustomerByTelegramId(owner, 1)).toBeNull();
    await expect(createCustomer(owner, { displayName: "TG2", telegramUserId: tg })).rejects.toMatchObject({
      code: "unique_violation",
    });
  });

  it("saves a configuration under an 8-character code, never changes it, and finds it by the code", async () => {
    const code = newPublicCode();
    expect(code).toMatch(/^[a-z2-7]{8}$/);
    const saved = await saveConfiguration(owner, {
      kind: "pc",
      createdVia: "web",
      items: [{ productId: "p1" as never, qty: 1 }],
      publicCode: code,
    });
    expect(saved.publicCode).toBe(code);
    expect((await getConfigurationByCode(owner, code))?.id).toBe(saved.id);
    expect(await getConfigurationByCode(owner, "zzzzzzzz")).toBeNull();
    const child = await saveConfiguration(owner, { kind: "pc", createdVia: "web", parentId: saved.id });
    expect(child.publicCode).not.toBe(code);
    await expect(saveConfiguration(owner, { kind: "pc", createdVia: "web", publicCode: code })).rejects.toMatchObject({
      code: "unique_violation",
    });
    await expect(
      owner.$client.query("update sales.configurations set kind = 'setup' where id = $1", [saved.id]),
    ).rejects.toThrow(/permission denied|immutable/);
  });
});

describe("a whole order, from the request to the close (database level)", () => {
  it("passes every step with the journal, the money and the closing check in order", async () => {
    const o = await draftOrder();
    const actor = { kind: "owner", id: "owner-1" } as const;
    const customer = { kind: "customer", id: "tg:1" } as const;

    // estimate: manual check mark, send, accept
    const quote = await getQuote(owner, o.quoteId);
    expect(quote?.lines).toHaveLength(2);
    await markQuoteSent(owner, o.quoteId, { checkedBy: adminUserId, validUntil: new Date("2026-10-07T08:00:00Z") });
    expect(
      (
        await applyTransition(owner, {
          orderId: o.orderId,
          event: { type: "SEND_ESTIMATE", quoteId: o.quoteId, manuallyChecked: true },
          actor,
        })
      ).to,
    ).toBe("estimate_sent");
    await markQuoteAccepted(owner, o.quoteId, { channel: "bot" });
    const accepted = await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "ACCEPT", quoteId: o.quoteId, consentIds: [], channel: "bot" },
      actor: customer,
      expectedFrom: "estimate_sent",
      changes: { accepted_at: "2026-10-06T09:00:00Z" },
    });
    expect(accepted).toMatchObject({ seq: 2, from: "estimate_sent", to: "accepted" });

    // 30 % fee by QR with a receipt; purchase money by transfer to the sole proprietor
    const feeId = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "fee_advance",
      direction: "in",
      method: "xolis_qr",
      amountSum: advance,
    });
    await expect(confirmPayment(owner, feeId, { by: "owner-1" })).rejects.toMatchObject({
      code: "check_violation",
      constraint: "payments_fee_chk",
    });
    await confirmPayment(owner, feeId, { by: "owner-1", fiscalReceiptNo: "XOLIS-1001" });
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "FEE_PREPAID", paymentId: feeId },
      actor,
      changes: { fee_prepaid: true },
    });
    const fundsId = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: limit,
    });
    await confirmPayment(owner, fundsId, { by: "owner-1", bankDocNo: "PP-77" });
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "FUNDS_RECEIVED", paymentIds: [fundsId], receivedAt: new Date() },
      actor,
      changes: {
        funds_received: true,
        funds_received_at: "2026-10-06T10:00:00Z",
        purchase_not_before: "2026-10-07T05:00:00Z",
      },
    });
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "MEETING_DONE" },
      actor,
      changes: { first_order_meeting_done: true },
    });
    await applyTransition(owner, { orderId: o.orderId, event: { type: "START_PURCHASE" }, actor });

    // purchases: one of them is returned to the shop partly (a negative row)
    const first = await recordPurchase(owner, {
      orderId: o.orderId,
      vendorId,
      qty: 1,
      amountSum: 2_590_000,
      paidVia: "bank_transfer",
      receiptKind: "fiscal",
      receiptNo: "CH-1",
      boughtBy: "owner-1",
    });
    const second = await recordPurchase(owner, {
      orderId: o.orderId,
      vendorId,
      qty: 1,
      amountSum: 8_880_000,
      paidVia: "bank_transfer",
      receiptKind: "fiscal",
      receiptNo: "CH-2",
      boughtBy: "owner-1",
    });
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "PURCHASE_RECORDED", purchaseId: first },
      actor: { kind: "assistant", id: "helper" },
    });
    await returnPurchase(owner, second, { amountSum: 500_000, boughtBy: "owner-1" });
    expect((await listPurchases(owner, o.orderId)).map((p) => p.amountSum)).toEqual([2_590_000, 8_880_000, -500_000]);
    await applyTransition(owner, { orderId: o.orderId, event: { type: "PURCHASE_DONE" }, actor });

    // not reconciled yet: the rest of the money is still with the sole proprietor
    let money = await orderMoney(owner, o.orderId);
    expect(money).toMatchObject({
      fundsReceived: limit,
      receiptsTotal: 10_970_000,
      refunded: 0,
      hasLimitOverrunConsent: false,
    });

    await applyTransition(owner, { orderId: o.orderId, event: { type: "SEND_REPORT", reportId: "r1" }, actor });
    await applyTransition(owner, { orderId: o.orderId, event: { type: "REPORT_ACCEPTED" }, actor: customer });
    const remainder = limit - 10_970_000;
    const refundId = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "remainder_refund",
      direction: "out",
      method: "bank_transfer_out",
      amountSum: remainder,
    });
    await confirmPayment(owner, refundId, { by: "owner-1", bankDocNo: "PP-78" });
    money = await orderMoney(owner, o.orderId);
    expect(money.fundsReceived).toBe(money.receiptsTotal + money.refunded + money.documentedLosses);
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "REMAINDER_SETTLED", refundPaymentId: refundId },
      actor,
    });

    // assembly, tests, handover with the 70 % fee by QR
    for (const type of ["MATERIALS_ACCEPTED", "ASSEMBLED", "TESTS_PASSED", "DISPATCH"] as const) {
      await applyTransition(owner, { orderId: o.orderId, event: { type }, actor });
    }
    const finalId = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "fee_final",
      direction: "in",
      method: "xolis_qr",
      amountSum: feeTotal - advance,
    });
    await confirmPayment(owner, finalId, { by: "owner-1", fiscalReceiptNo: "XOLIS-1002" });
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "HANDOVER", actId: "a1", finalPaymentId: finalId },
      actor,
      changes: { handed_over_at: "2026-10-20T10:00:00Z", warranty_until: "2027-10-20T10:00:00Z" },
    });
    const closed = await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "CLOSE" },
      actor: { kind: "system", id: "system" },
    });
    expect(closed.to).toBe("closed");

    const events = await listOrderEvents(owner, o.orderId);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.at(0)?.fromStatus).toBe("estimate_draft");
    expect(events.at(-1)?.toStatus).toBe("closed");
    expect(events.find((e) => e.event.type === "PURCHASE_RECORDED")?.actorKind).toBe("assistant");
    const final = await getOrder(owner, o.orderId);
    expect(final).toMatchObject({ status: "closed", feePrepaid: true, fundsReceived: true });
    expect(final?.warrantyUntil?.toISOString()).toBe("2027-10-20T10:00:00.000Z");
    expect((await listPayments(owner, o.orderId)).map((p) => p.kind)).toEqual([
      "fee_advance",
      "purchase_funds",
      "remainder_refund",
      "fee_final",
    ]);
    const ctx = await loadOrderContext(owner, o.orderId);
    expect(ctx?.quote?.lines).toHaveLength(2);
    expect(ctx?.offer).toEqual({ uz: "stub", ru: "stub" });
    expect(ctx?.money.fundsReceived).toBe(limit);
    expect(await loadOrderContext(owner, "00000000-0000-7000-8000-000000000000")).toBeNull();
    expect((await latestQuoteOfOrder(owner, o.orderId))?.status).toBe("accepted");
  });

  it("refuses the close while the money does not reconcile, with the rule named", async () => {
    const o = await draftOrder();
    const actor = { kind: "owner", id: "owner-1" } as const;
    const fundsId = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: 1_000_000,
    });
    await confirmPayment(owner, fundsId, { by: "owner-1" });
    await applyTransition(owner, {
      orderId: o.orderId,
      event: { type: "CANCEL", point: "after_accept_before_purchase", reason: "x" },
      actor,
    });
    await expect(
      applyTransition(owner, { orderId: o.orderId, event: { type: "CANCEL_SETTLED" }, actor }),
    ).rejects.toMatchObject({
      name: "DbRuleError",
      code: "not_reconciled",
    });
    const refund = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "funds_refund",
      direction: "out",
      method: "bank_transfer_out",
      amountSum: 1_000_000,
    });
    await confirmPayment(owner, refund, { by: "owner-1" });
    expect((await applyTransition(owner, { orderId: o.orderId, event: { type: "CANCEL_SETTLED" }, actor })).to).toBe(
      "cancelled",
    );
  });

  it("raises the named rules for the other steps (assistant, graph, stale status, limit, funds)", async () => {
    const o = await draftOrder();
    const helper = { kind: "assistant", id: "helper" } as const;
    const err = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return e as DbRuleError;
      }
      throw new Error("expected an error");
    };
    expect(
      (await err(applyTransition(owner, { orderId: o.orderId, event: { type: "FEE_PREPAID" }, actor: helper }))).code,
    ).toBe("actor_not_allowed");
    expect(
      (
        await err(
          applyTransition(owner, {
            orderId: o.orderId,
            event: { type: "ACCEPT" },
            actor: { kind: "customer", id: "c" },
          }),
        )
      ).code,
    ).toBe("invalid_transition");
    expect(
      (
        await err(
          applyTransition(owner, {
            orderId: o.orderId,
            event: { type: "SEND_ESTIMATE" },
            actor: { kind: "owner", id: "o" },
            expectedFrom: "accepted",
          }),
        )
      ).code,
    ).toBe("stale_status");
    expect(
      (
        await err(
          applyTransition(owner, {
            orderId: o.orderId,
            event: { type: "SEND_ESTIMATE" },
            actor: { kind: "owner", id: "o" },
            changes: { status: "closed" },
          }),
        )
      ).code,
    ).toBe("unknown_change");
    expect(
      (
        await err(
          applyTransition(owner, {
            orderId: "00000000-0000-7000-8000-000000000000",
            event: { type: "SEND_ESTIMATE" },
            actor: { kind: "owner", id: "o" },
          }),
        )
      ).code,
    ).toBe("order_not_found");
    expect(
      (
        await err(
          recordPurchase(owner, {
            orderId: o.orderId,
            vendorId,
            qty: 1,
            amountSum: 1,
            paidVia: "bank_transfer",
            receiptKind: "fiscal",
            receiptNo: "x",
            boughtBy: "t",
          }),
        )
      ).code,
    ).toBe("funds_exceeded");
    const fundsId = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: limit + 5_000_000,
    });
    await confirmPayment(owner, fundsId, { by: "o" });
    expect(
      (
        await err(
          recordPurchase(owner, {
            orderId: o.orderId,
            vendorId,
            qty: 1,
            amountSum: limit + 1,
            paidVia: "bank_transfer",
            receiptKind: "fiscal",
            receiptNo: "x",
            boughtBy: "t",
          }),
        )
      ).code,
    ).toBe("limit_exceeded");
    await recordConsent(owner, { customerId: o.customerId, orderId: o.orderId, kind: "limit_overrun", granted: true });
    await expect(
      recordPurchase(owner, {
        orderId: o.orderId,
        vendorId,
        qty: 1,
        amountSum: limit + 1,
        paidVia: "bank_transfer",
        receiptKind: "fiscal",
        receiptNo: "x2",
        boughtBy: "t",
      }),
    ).resolves.toBeTypeOf("string");
    expect((await orderMoney(owner, o.orderId)).hasLimitOverrunConsent).toBe(true);
  });

  it("writes the status and an outbox row in one transaction, and a repeated dispatch does not duplicate the outbox", async () => {
    const o = await draftOrder();
    const actor = { kind: "owner", id: "owner-1" } as const;
    const dispatch = () =>
      owner.transaction(async (tx) => {
        const t = await applyTransition(tx, {
          orderId: o.orderId,
          event: { type: "SEND_ESTIMATE" },
          actor,
          expectedFrom: "estimate_draft",
        });
        await enqueueOutbox(tx, {
          kind: "telegram_message",
          payload: { to: "customer", key: "estimate_sent" },
          dedupeKey: `${o.orderId}:${t.seq}`,
        });
        return t;
      });
    expect((await dispatch()).to).toBe("estimate_sent");
    await expect(dispatch()).rejects.toMatchObject({ code: "stale_status" });
    const rows = await owner.$client.query("select 1 from ops.outbox where dedupe_key like $1", [`${o.orderId}:%`]);
    expect(rows.rowCount).toBe(1);
    // A transaction that fails after the status step leaves no status and no event behind.
    const p = await draftOrder();
    await expect(
      owner.transaction(async (tx) => {
        await applyTransition(tx, { orderId: p.orderId, event: { type: "SEND_ESTIMATE" }, actor });
        throw new Error("outbox failed");
      }),
    ).rejects.toThrow("outbox failed");
    expect((await getOrder(owner, p.orderId))?.status).toBe("estimate_draft");
    expect(await listOrderEvents(owner, p.orderId)).toHaveLength(0);
  });
});

describe("payments", () => {
  it("voids an expected payment and corrects a confirmed one with a reversing row", async () => {
    const o = await draftOrder();
    const id = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: 1_000_000,
    });
    await voidPayment(owner, id);
    const bad = await expectPayment(owner, {
      orderId: o.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: 2_000_000,
    });
    const confirmed = await confirmPayment(owner, bad, { by: "o", bankDocNo: "PP-1" });
    await reversePayment(owner, confirmed.id, { by: "o", bankDocNo: "PP-2" });
    expect((await orderMoney(owner, o.orderId)).fundsReceived).toBe(0);
    const rows = await listPayments(owner, o.orderId);
    expect(rows.map((r) => [r.status, r.amountSum])).toEqual([
      ["void", 1_000_000],
      ["confirmed", 2_000_000],
      ["confirmed", -2_000_000],
    ]);
    await expect(voidPayment(owner, bad)).rejects.toMatchObject({ code: "append_only" });
    await expect(confirmPayment(owner, "00000000-0000-7000-8000-000000000000", { by: "o" })).rejects.toThrow(
      /not found/,
    );
  });

  it("refuses a pair the architecture forbids, naming the constraint", async () => {
    const o = await draftOrder();
    await expect(
      expectPayment(owner, {
        orderId: o.orderId,
        kind: "purchase_funds",
        direction: "in",
        method: "xolis_qr",
        amountSum: 1_000,
      }),
    ).rejects.toMatchObject({ code: "check_violation", constraint: "payments_purchase_funds_chk" });
  });
});

describe("quotes", () => {
  it("expires and supersedes a sent quote and freezes it", async () => {
    const o = await draftOrder();
    await markQuoteSent(owner, o.quoteId, { checkedBy: adminUserId, watermarkDraft: true });
    expect((await getQuote(owner, o.quoteId))?.watermarkDraft).toBe(true);
    await setQuoteStatus(owner, o.quoteId, "expired");
    await setQuoteStatus(owner, o.quoteId, "superseded");
    await expect(markQuoteAccepted(owner, o.quoteId, {})).rejects.toMatchObject({ code: "immutable" });
    expect(await getQuote(owner, "00000000-0000-7000-8000-000000000000")).toBeNull();
  });

  it("refuses a quote whose fee parts do not add up", async () => {
    const o = await draftOrder();
    await expect(
      insertQuoteDraft(
        owner,
        {
          orderId: o.orderId,
          version: 2,
          totals: {},
          componentsSum: 1,
          reserveBp: 300,
          reserveSum: 1,
          purchaseLimit: 10,
          feeTotal: 100,
          feeCommissionLine: 50,
          feeWorksLine: 50,
          feeAdvance: 30,
          feeFinal: 80,
          settingsVersion: "x",
        },
        [],
      ),
    ).rejects.toMatchObject({ code: "check_violation", constraint: "quotes_fee_split_chk" });
  });
});

describe("reserves, other income and deal volume", () => {
  it("keeps the reserve balance as a sum of rows and refuses a zero row", async () => {
    const before = await reserveBalance(owner, "warranty");
    await appendReserve(owner, { fund: "warranty", amountSum: 150_000, reason: "order contribution" });
    await appendReserve(owner, { fund: "warranty", amountSum: -40_000, reason: "warranty case G-1" });
    expect(await reserveBalance(owner, "warranty")).toBe(before + 110_000);
    await expect(appendReserve(owner, { fund: "tax_risk", amountSum: 0, reason: "nothing" })).rejects.toMatchObject({
      code: "check_violation",
    });
  });

  it("sums the deals of a year with other income and returns zeros for an empty year", async () => {
    expect(await dealVolume(owner, 2099)).toEqual({
      year: 2099,
      receiptsSum: 0,
      feeInSum: 0,
      feeRefundSum: 0,
      otherIncomeSum: 0,
      dealsSum: 0,
    });
    await addOtherIncome(owner, { year: 2098, period: "2098-Q1", amountSum: 4_000_000, enteredBy: "accountant" });
    await addOtherIncome(owner, {
      year: 2098,
      period: "2098-Q2",
      amountSum: 1_000_000,
      note: "second",
      enteredBy: "accountant",
    });
    expect(await dealVolume(owner, 2098)).toMatchObject({ otherIncomeSum: 5_000_000, dealsSum: 5_000_000 });
    await expect(
      addOtherIncome(owner, { year: 2098, period: "x", amountSum: 0, enteredBy: "a" }),
    ).rejects.toMatchObject({ code: "check_violation" });
  });

  it("lists orders by status, oldest first", async () => {
    const o = await draftOrder();
    const rows = await listOrdersByStatus(owner, ["estimate_draft"], 1000);
    expect(rows.some((r) => r.id === o.orderId)).toBe(true);
    expect(await listOrdersByStatus(owner, ["closed"], 0)).toEqual([]);
  });
});
