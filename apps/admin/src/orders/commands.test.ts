import { orders } from "@nivel/services";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "../auth/roles.ts";
import { fromFormData } from "./build-event.ts";
import type { Svc } from "./commands.ts";
import * as commands from "./commands.ts";
import { GUARD_TEXT } from "./messages.ts";
import { fakeCtx } from "./test-support/ctx.ts";

const ORDER = "0199aaaa-bbbb-7ccc-8ddd-000000000001";
const PAY = "0199aaaa-bbbb-7ccc-8ddd-000000000002";
const QUOTE = "0199aaaa-bbbb-7ccc-8ddd-000000000003";
const VENDOR = "0199aaaa-bbbb-7ccc-8ddd-000000000004";
const FILE = "0199aaaa-bbbb-7ccc-8ddd-000000000005";
const ACT = "0199aaaa-bbbb-7ccc-8ddd-000000000006";
const LEAD = "0199aaaa-bbbb-7ccc-8ddd-000000000007";
const CUSTOMER = "0199aaaa-bbbb-7ccc-8ddd-000000000008";

const ctxOf = (role: Role, svc: Partial<Svc> = {}) => fakeCtx(role, svc);
const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return fromFormData(f);
};

describe("events of the order", () => {
  it("sends the event as the person who is signed in, and says the new status", async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, status: "purchasing" as const }));
    const ctx = ctxOf("owner", { orders: { dispatch } } as unknown as Partial<Svc>);
    const r = await commands.runEvent(ctx, ORDER, "START_PURCHASE", form({}));
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toContain("Закупка");
    expect(dispatch).toHaveBeenCalledWith(ORDER, { type: "START_PURCHASE" }, { kind: "owner", id: "owner-1" }, ctx.rt);
  });

  it("shows the Russian text of a refusal of the automaton and never the code", async () => {
    const dispatch = vi.fn(async () => ({ ok: false as const, error: "not_reconciled" as const }));
    const r = await commands.runEvent(
      ctxOf("owner", { orders: { dispatch } } as unknown as Partial<Svc>),
      ORDER,
      "REMAINDER_SETTLED",
      form({}),
    );
    expect(r).toEqual({ ok: false, message: GUARD_TEXT.not_reconciled });
  });

  it("does not even ask the services when the assistant presses a money button", async () => {
    const dispatch = vi.fn();
    const ctx = ctxOf("assistant", { orders: { dispatch } } as unknown as Partial<Svc>);
    for (const type of [
      "START_PURCHASE",
      "FEE_PREPAID",
      "FUNDS_RECEIVED",
      "HANDOVER",
      "REMAINDER_SETTLED",
      "CANCEL_SETTLED",
    ]) {
      const r = await commands.runEvent(ctx, ORDER, type, form({ paymentId: PAY }));
      expect(r, type).toMatchObject({ ok: false, denied: true });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("lets the assistant assemble and pass the tests", async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, status: "testing" as const }));
    const ctx = ctxOf("assistant", { orders: { dispatch } } as unknown as Partial<Svc>);
    expect((await commands.runEvent(ctx, ORDER, "ASSEMBLED", form({}))).ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      ORDER,
      { type: "ASSEMBLED" },
      { kind: "assistant", id: "assistant-1" },
      ctx.rt,
    );
  });

  it("turns a failure of the services into text", async () => {
    const dispatch = vi.fn(async () => {
      throw new orders.NotFoundError("order");
    });
    const r = await commands.runEvent(
      ctxOf("owner", { orders: { dispatch } } as unknown as Partial<Svc>),
      ORDER,
      "DISPATCH",
      form({}),
    );
    expect(r).toEqual({ ok: false, message: "Заказ не найден." });
  });

  it("refuses a malformed form before the services", async () => {
    const dispatch = vi.fn();
    const r = await commands.runEvent(
      ctxOf("owner", { orders: { dispatch } } as unknown as Partial<Svc>),
      ORDER,
      "FEE_PREPAID",
      form({}),
    );
    expect(r).toMatchObject({ ok: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("cancels through orders.cancel with the reason and the owner's inputs, never with amounts", async () => {
    const cancel = vi.fn(async () => ({ ok: true as const, status: "cancelling" as const }));
    const ctx = ctxOf("owner", { orders: { cancel } } as unknown as Partial<Svc>);
    const r = await commands.runEvent(
      ctx,
      ORDER,
      "CANCEL",
      form({ reason: "Клиент передумал", assemblyDonePercent: "40", documentedLosses: "120 000", feeToRefund: "999" }),
    );
    expect(r.ok).toBe(true);
    expect(cancel).toHaveBeenCalledWith(
      { orderId: ORDER, reason: "Клиент передумал", assemblyDoneBp: 4000, documentedLosses: 120_000 },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("asks for a reason before cancelling", async () => {
    const cancel = vi.fn();
    const r = await commands.runEvent(
      ctxOf("owner", { orders: { cancel } } as unknown as Partial<Svc>),
      ORDER,
      "CANCEL",
      form({}),
    );
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("причин");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not let the assistant cancel", async () => {
    const cancel = vi.fn();
    const r = await commands.runEvent(
      ctxOf("assistant", { orders: { cancel } } as unknown as Partial<Svc>),
      ORDER,
      "CANCEL",
      form({ reason: "x" }),
    );
    expect(r).toMatchObject({ ok: false, denied: true });
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("the estimate", () => {
  it("is sent only with the mark of the manual check", async () => {
    const send = vi.fn(async () => ({ ok: true as const, status: "estimate_sent" as const }));
    const ctx = ctxOf("owner", { quotes: { send } } as unknown as Partial<Svc>);
    const without = await commands.sendQuote(ctx, ORDER, QUOTE, form({}));
    expect(without).toMatchObject({ ok: false });
    expect(without.message).toContain("вручную");
    expect(send).not.toHaveBeenCalled();
    const checked = await commands.sendQuote(ctx, ORDER, QUOTE, form({ checked: "on" }));
    expect(checked.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ orderId: ORDER, quoteId: QUOTE }, { kind: "owner", id: "owner-1" }, ctx.rt);
  });

  it("is not sent by the assistant", async () => {
    const send = vi.fn();
    const r = await commands.sendQuote(
      ctxOf("assistant", { quotes: { send } } as unknown as Partial<Svc>),
      ORDER,
      QUOTE,
      form({ checked: "on" }),
    );
    expect(r).toMatchObject({ ok: false, denied: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the refusal of the automaton in Russian", async () => {
    const send = vi.fn(async () => ({ ok: false as const, error: "compat_block" as const }));
    const r = await commands.sendQuote(
      ctxOf("owner", { quotes: { send } } as unknown as Partial<Svc>),
      ORDER,
      QUOTE,
      form({ checked: "on" }),
    );
    expect(r.message).toBe(GUARD_TEXT.compat_block);
  });
});

describe("payments", () => {
  it("expects a payment of a kind; the amount of the fixed kinds is not asked", async () => {
    const expect_ = vi.fn(async () => ({ paymentId: PAY }));
    const ctx = ctxOf("owner", { payments: { expect: expect_ } } as unknown as Partial<Svc>);
    const r = await commands.expectPayment(ctx, ORDER, form({ kind: "fee_advance", amountSum: "5" }));
    expect(r.ok).toBe(true);
    expect(expect_).toHaveBeenCalledWith(
      { orderId: ORDER, kind: "fee_advance" },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("passes the typed amount for a kind the quote does not fix", async () => {
    const expect_ = vi.fn(async () => ({ paymentId: PAY }));
    const ctx = ctxOf("owner", { payments: { expect: expect_ } } as unknown as Partial<Svc>);
    await commands.expectPayment(ctx, ORDER, form({ kind: "fee_extra", amountSum: "250 000" }));
    expect(expect_).toHaveBeenCalledWith(
      { orderId: ORDER, kind: "fee_extra", amountSum: 250_000 },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("explains in Russian that the purchase money cannot go through the QR", async () => {
    const expect_ = vi.fn(async () => {
      throw orders.ValidationError.of("method", "pair_invalid", "purchase_funds cannot be paid by xolis_qr");
    });
    const r = await commands.expectPayment(
      ctxOf("owner", { payments: { expect: expect_ } } as unknown as Partial<Svc>),
      ORDER,
      form({ kind: "purchase_funds", method: "xolis_qr" }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("только переводом на счёт ИП");
  });

  it("confirms with the number of the receipt and the document of the bank", async () => {
    const confirm = vi.fn(async () => ({ paymentId: PAY, kind: "fee_advance" as const, amountSum: 100 }));
    const ctx = ctxOf("owner", { payments: { confirm } } as unknown as Partial<Svc>);
    const r = await commands.confirmPayment(ctx, form({ paymentId: PAY, fiscalReceiptNo: " FR-123 ", bankDocNo: "" }));
    expect(r.ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      { paymentId: PAY, fiscalReceiptNo: "FR-123" },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("marks a payer who is not the customer and carries the statement file", async () => {
    const confirm = vi.fn(async () => ({ paymentId: PAY, kind: "fee_advance" as const, amountSum: 100 }));
    const ctx = ctxOf("owner", { payments: { confirm } } as unknown as Partial<Svc>);
    await commands.confirmPayment(
      ctx,
      form({ paymentId: PAY, fiscalReceiptNo: "FR-1", payerOther: "on", statementFileId: FILE }),
    );
    expect(confirm).toHaveBeenCalledWith(
      { paymentId: PAY, fiscalReceiptNo: "FR-1", payerIsCustomer: false, thirdPartyStatementFileId: FILE },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("is closed to the assistant", async () => {
    const confirm = vi.fn();
    const expect_ = vi.fn();
    const void_ = vi.fn();
    const ctx = ctxOf("assistant", { payments: { confirm, expect: expect_, void: void_ } } as unknown as Partial<Svc>);
    expect(await commands.confirmPayment(ctx, form({ paymentId: PAY }))).toMatchObject({ denied: true });
    expect(await commands.expectPayment(ctx, ORDER, form({ kind: "fee_advance" }))).toMatchObject({ denied: true });
    expect(await commands.voidPayment(ctx, form({ paymentId: PAY, reason: "x" }))).toMatchObject({ denied: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(expect_).not.toHaveBeenCalled();
    expect(void_).not.toHaveBeenCalled();
  });

  it("voids with a reason", async () => {
    const void_ = vi.fn(async () => undefined);
    const ctx = ctxOf("owner", { payments: { void: void_ } } as unknown as Partial<Svc>);
    expect((await commands.voidPayment(ctx, form({ paymentId: PAY, reason: "Клиент не оплатил" }))).ok).toBe(true);
    expect(void_).toHaveBeenCalledWith(
      { paymentId: PAY, reason: "Клиент не оплатил" },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });
});

describe("purchases", () => {
  const base = {
    vendorId: VENDOR,
    qty: "1",
    amountSum: "2 800 000",
    paidVia: "bank_transfer",
    receiptKind: "fiscal",
    receiptNo: "CH-100",
    receiptFileIds: FILE,
  };

  it("records a purchase with the receipt, the photo and the serial numbers, as the person signed in", async () => {
    const record = vi.fn(async () => ({ ok: true as const, status: "purchasing" as const, purchaseId: "p1" }));
    const ctx = ctxOf("assistant", { purchases: { record } } as unknown as Partial<Svc>);
    const r = await commands.recordPurchase(
      ctx,
      ORDER,
      form({ ...base, quoteLineId: ACT, serials: "SN1\nSN2 \n\n", vendorWarrantyMonths: "36" }),
    );
    expect(r.ok).toBe(true);
    expect(record).toHaveBeenCalledWith(
      {
        orderId: ORDER,
        vendorId: VENDOR,
        quoteLineId: ACT,
        qty: 1,
        amountSum: 2_800_000,
        paidVia: "bank_transfer",
        receiptKind: "fiscal",
        receiptNo: "CH-100",
        serials: ["SN1", "SN2"],
        vendorWarrantyMonths: 36,
        receiptFileIds: [FILE],
      },
      { kind: "assistant", id: "assistant-1" },
      ctx.rt,
    );
  });

  it("carries the ESF number, status and photo", async () => {
    const record = vi.fn(async () => ({ ok: true as const, status: "purchasing" as const, purchaseId: "p1" }));
    const ctx = ctxOf("owner", { purchases: { record } } as unknown as Partial<Svc>);
    await commands.recordPurchase(
      ctx,
      ORDER,
      form({ ...base, receiptKind: "esf", receiptNo: "", esfNo: "ESF-7", esfStatus: "pending" }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ receiptKind: "esf", esfNo: "ESF-7", esfStatus: "pending" }),
      expect.anything(),
      ctx.rt,
    );
    const call = (record.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call).not.toHaveProperty("receiptNo");
  });

  it("shows the limit and the funds refusals in Russian", async () => {
    for (const error of ["limit_exceeded", "funds_exceeded", "consent_missing"] as const) {
      const record = vi.fn(async () => ({ ok: false as const, error }));
      const r = await commands.recordPurchase(
        ctxOf("owner", { purchases: { record } } as unknown as Partial<Svc>),
        ORDER,
        form(base),
      );
      expect(r).toEqual({ ok: false, message: GUARD_TEXT[error] });
    }
  });

  it("refuses a sum that is not a whole number before the services", async () => {
    const record = vi.fn();
    const r = await commands.recordPurchase(
      ctxOf("owner", { purchases: { record } } as unknown as Partial<Svc>),
      ORDER,
      form({ ...base, amountSum: "2,5" }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Сумма");
    expect(record).not.toHaveBeenCalled();
  });

  it("is closed to the translator and the accountant", async () => {
    for (const role of ["translator", "accountant"] as const) {
      const record = vi.fn();
      const r = await commands.recordPurchase(
        ctxOf(role, { purchases: { record } } as unknown as Partial<Svc>),
        ORDER,
        form(base),
      );
      expect(r).toMatchObject({ ok: false, denied: true });
      expect(record).not.toHaveBeenCalled();
    }
  });
});

describe("consents that move money", () => {
  it("are recorded by the owner for the customer of the order, by the admin channel", async () => {
    const record = vi.fn(async () => ({ id: "c1" }));
    const ctx = ctxOf("owner", { consents: { record } } as unknown as Partial<Svc>);
    const r = await commands.recordConsent(ctx, ORDER, form({ kind: "limit_overrun", note: "Сказал по телефону" }));
    expect(r.ok).toBe(true);
    expect(record).toHaveBeenCalledWith(
      {
        kind: "limit_overrun",
        customerId: CUSTOMER,
        orderId: ORDER,
        granted: true,
        channel: "admin",
        evidence: { note: "Сказал по телефону", recordedBy: "admin:owner-1", via: "owner_statement" },
      },
      ctx.rt,
    );
  });

  it("leave a trace of who recorded them and on what ground: the evidence and a line of the journal", async () => {
    const record = vi.fn(async () => ({ id: "c-77" }));
    const ctx = ctxOf("owner", { consents: { record } } as unknown as Partial<Svc>);
    await commands.recordConsent(ctx, ORDER, form({ kind: "no_receipt_purchase", note: "Написал в боте 12.10" }));
    expect(ctx.journal).toEqual([
      {
        actor: "admin:owner-1",
        action: "orders.consent_record",
        entity: "ops.consents",
        entityId: "c-77",
        after: { kind: "no_receipt_purchase", orderId: ORDER, channel: "admin" },
        ipHash: "ip-1",
      },
    ]);
  });

  it("are not recorded without the ground: the person says how the customer agreed", async () => {
    const record = vi.fn();
    const ctx = ctxOf("owner", { consents: { record } } as unknown as Partial<Svc>);
    const r = await commands.recordConsent(ctx, ORDER, form({ kind: "limit_overrun" }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("как");
    expect((await commands.recordConsent(ctx, ORDER, form({ kind: "limit_overrun", note: "x".repeat(501) }))).ok).toBe(
      false,
    );
    expect(record).not.toHaveBeenCalled();
    expect(ctx.journal).toEqual([]);
  });

  it("take the customer from the order, and a role that may not learns nothing about the order", async () => {
    const record = vi.fn();
    const ctx = ctxOf("owner", { consents: { record } } as unknown as Partial<Svc>);
    const gone = await commands.recordConsent(
      ctx,
      "0199aaaa-bbbb-7ccc-8ddd-0000000000aa",
      form({ kind: "limit_overrun", note: "Сказал" }),
    );
    expect(gone).toMatchObject({ ok: false, message: "Заказ не найден." });
    const lookups = vi.fn(async () => CUSTOMER);
    const helper = ctxOf("assistant", { consents: { record } } as unknown as Partial<Svc>);
    helper.facts.customerOf = lookups;
    expect(await commands.recordConsent(helper, ORDER, form({ kind: "limit_overrun", note: "Сказал" }))).toMatchObject({
      denied: true,
    });
    expect(lookups).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("are not recorded by the assistant", async () => {
    const record = vi.fn();
    const r = await commands.recordConsent(
      ctxOf("assistant", { consents: { record } } as unknown as Partial<Svc>),
      ORDER,
      form({ kind: "limit_overrun", note: "Сказал" }),
    );
    expect(r).toMatchObject({ ok: false, denied: true });
    expect(record).not.toHaveBeenCalled();
  });

  it("only of the four kinds that move money", async () => {
    const record = vi.fn();
    const r = await commands.recordConsent(
      ctxOf("owner", { consents: { record } } as unknown as Partial<Svc>),
      ORDER,
      form({ kind: "pd_processing", note: "Сказал" }),
    );
    expect(r.ok).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});

describe("the report, the acts, the requests", () => {
  it("generates and sends the report as the owner only", async () => {
    const generate = vi.fn(async () => ({
      reportId: QUOTE,
      version: 1,
      receivedSum: 1,
      spentSum: 1,
      discountsSum: 0,
      remainderSum: 0,
    }));
    const send = vi.fn(async () => ({ ok: true as const, status: "report_sent" as const }));
    const ctx = ctxOf("owner", { reports: { generate, send } } as unknown as Partial<Svc>);
    expect((await commands.generateReport(ctx, ORDER)).ok).toBe(true);
    expect(ctx.journal).toEqual([
      expect.objectContaining({
        actor: "admin:owner-1",
        action: "orders.report_generate",
        entity: "sales.commission_reports",
        entityId: QUOTE,
      }),
    ]);
    expect((await commands.sendReport(ctx, ORDER, form({ reportId: QUOTE }))).ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ orderId: ORDER, reportId: QUOTE }, { kind: "owner", id: "owner-1" }, ctx.rt);
    const helper = ctxOf("assistant", { reports: { generate, send } } as unknown as Partial<Svc>);
    expect(await commands.generateReport(helper, ORDER)).toMatchObject({ denied: true });
    expect(await commands.sendReport(helper, ORDER, form({ reportId: QUOTE }))).toMatchObject({ denied: true });
  });

  it("answers the objection of the customer", async () => {
    const resolveObjection = vi.fn(async () => undefined);
    const ctx = ctxOf("owner", { reports: { resolveObjection } } as unknown as Partial<Svc>);
    expect((await commands.resolveObjection(ctx, ORDER, form({ note: "Чек приложен" }))).ok).toBe(true);
    expect(resolveObjection).toHaveBeenCalledWith(
      { orderId: ORDER, note: "Чек приложен" },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("draws an act with its lines, one line per row of the text", async () => {
    const generate = vi.fn(async () => ({ actId: ACT }));
    const ctx = ctxOf("assistant", { acts: { generate } } as unknown as Partial<Svc>);
    const r = await commands.generateAct(
      ctx,
      ORDER,
      form({ kind: "material_acceptance", lines: "SSD Samsung 1TB x 2\nКулер" }),
    );
    expect(r.ok).toBe(true);
    expect(generate).toHaveBeenCalledWith(
      {
        orderId: ORDER,
        kind: "material_acceptance",
        lines: [
          { title: "SSD Samsung 1TB", qty: 2 },
          { title: "Кулер", qty: 1 },
        ],
      },
      { kind: "assistant", id: "assistant-1" },
      ctx.rt,
    );
  });

  it("signs a paper act with the photo, the owner only", async () => {
    const sign = vi.fn(async () => ({ signed: true, queued: false }));
    const ctx = ctxOf("owner", { acts: { sign } } as unknown as Partial<Svc>);
    expect((await commands.signPaperAct(ctx, form({ actId: ACT, fileId: FILE }))).ok).toBe(true);
    expect(sign).toHaveBeenCalledWith(
      { actId: ACT, via: "paper_photo", evidence: { fileId: FILE } },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
    const helper = ctxOf("assistant", { acts: { sign } } as unknown as Partial<Svc>);
    expect(await commands.signPaperAct(helper, form({ actId: ACT, fileId: FILE }))).toMatchObject({ denied: true });
    expect(await commands.signPaperAct(ctx, form({ actId: ACT }))).toMatchObject({ ok: false });
  });

  it("binds a request of the site to the customer the owner chose, and takes a request into work", async () => {
    const bindCustomer = vi.fn(async () => ({ bound: true }));
    const convert = vi.fn(async () => ({ orderId: ORDER, number: "NV-2026-0001", created: true }));
    const ctx = ctxOf("assistant", { leads: { bindCustomer, convert } } as unknown as Partial<Svc>);
    const bound = await commands.bindLead(ctx, LEAD, form({ customerId: CUSTOMER }));
    expect(bound.ok).toBe(true);
    expect(bindCustomer).toHaveBeenCalledWith(
      { leadId: LEAD, customerId: CUSTOMER },
      { kind: "assistant", id: "assistant-1" },
      ctx.rt,
    );
    const made = await commands.convertLead(ctx, LEAD);
    expect(made).toMatchObject({ ok: true, id: ORDER });
    expect(made.message).toContain("NV-2026-0001");
  });
});
