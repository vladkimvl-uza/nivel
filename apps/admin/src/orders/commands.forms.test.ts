// What the forms must bring before the services are asked, and the commands that the first test file leaves out.
import { describe, expect, it, vi } from "vitest";
import type { Role } from "../auth/roles.ts";
import { orders } from "@nivel/services";
import { fromFormData } from "./build-event.ts";
import type { Ctx, Svc } from "./commands.ts";
import * as commands from "./commands.ts";
import { SERVICE_FALLBACK } from "./messages.ts";

const ORDER = "0199aaaa-bbbb-7ccc-8ddd-000000000001";
const PAY = "0199aaaa-bbbb-7ccc-8ddd-000000000002";
const VENDOR = "0199aaaa-bbbb-7ccc-8ddd-000000000004";
const FILE = "0199aaaa-bbbb-7ccc-8ddd-000000000005";
const ACT = "0199aaaa-bbbb-7ccc-8ddd-000000000006";
const LEAD = "0199aaaa-bbbb-7ccc-8ddd-000000000007";
const CUSTOMER = "0199aaaa-bbbb-7ccc-8ddd-000000000008";

function ctxOf(role: Role, svc: Partial<Svc> = {}): Ctx {
  return {
    user: { id: `${role}-1`, role },
    svc: svc as Svc,
    rt: {} as Ctx["rt"],
    now: () => new Date("2026-10-12T05:00:00Z"),
  };
}
const form = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return fromFormData(f);
};
const none = {} as Partial<Svc>;
const refused = async (run: () => Promise<{ ok: boolean; message: string }>, text: string | RegExp) => {
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(text);
};

describe("payments", () => {
  it("a form without the kind, with a sum that is not whole, without the id or the reason is refused before the services", async () => {
    const owner = ctxOf("owner", none);
    await refused(() => commands.expectPayment(owner, ORDER, form({})), "вид платежа");
    await refused(
      () => commands.expectPayment(owner, ORDER, form({ kind: "fee_extra", amountSum: "1,5" })),
      "целое число",
    );
    await refused(() => commands.confirmPayment(owner, form({})), "Платёж не выбран");
    await refused(() => commands.voidPayment(owner, form({})), "Платёж не выбран");
    await refused(() => commands.voidPayment(owner, form({ paymentId: PAY })), "причину");
    await refused(() => commands.reversePayment(owner, form({})), "Платёж не выбран");
    await refused(() => commands.reversePayment(owner, form({ paymentId: PAY })), "причину");
    await refused(
      () => commands.reversePayment(owner, form({ paymentId: PAY, reason: "x", amountSum: "-1" })),
      "целое число",
    );
  });

  it("a confirmed payment is corrected with a reversal row, with the receipt or the bank document of the correction", async () => {
    const reverse = vi.fn(async () => ({ reversalId: "r1" }));
    const ctx = ctxOf("owner", { payments: { reverse } } as unknown as Partial<Svc>);
    const r = await commands.reversePayment(
      ctx,
      form({
        paymentId: PAY,
        reason: "Ошибка кассира",
        amountSum: "100 000",
        fiscalReceiptNo: "FR-9",
        bankDocNo: "PP-9",
      }),
    );
    expect(r).toMatchObject({ ok: true, id: "r1" });
    expect(reverse).toHaveBeenCalledWith(
      { paymentId: PAY, reason: "Ошибка кассира", amountSum: 100_000, fiscalReceiptNo: "FR-9", bankDocNo: "PP-9" },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
    await commands.reversePayment(ctx, form({ paymentId: PAY, reason: "Весь платёж" }));
    expect(reverse).toHaveBeenLastCalledWith({ paymentId: PAY, reason: "Весь платёж" }, expect.anything(), ctx.rt);
  });

  it("passes the way that was chosen, the bank document and the mark of another payer", async () => {
    const expect_ = vi.fn(async () => ({ paymentId: PAY }));
    const confirm = vi.fn(async () => ({ paymentId: PAY, kind: "purchase_funds" as const, amountSum: 1 }));
    const ctx = ctxOf("owner", { payments: { expect: expect_, confirm } } as unknown as Partial<Svc>);
    await commands.expectPayment(ctx, ORDER, form({ kind: "fee_extra", method: "merchant_card", amountSum: "5" }));
    expect(expect_).toHaveBeenCalledWith(
      { orderId: ORDER, kind: "fee_extra", method: "merchant_card", amountSum: 5 },
      expect.anything(),
      ctx.rt,
    );
    await commands.confirmPayment(ctx, form({ paymentId: PAY, bankDocNo: "PP-1", payerOther: "on" }));
    expect(confirm).toHaveBeenCalledWith(
      { paymentId: PAY, bankDocNo: "PP-1", payerIsCustomer: false },
      expect.anything(),
      ctx.rt,
    );
  });

  it("does not take the statement of a payer without the mark that the payer is not the customer", async () => {
    const confirm = vi.fn(async () => ({ paymentId: PAY, kind: "fee_advance" as const, amountSum: 1 }));
    const ctx = ctxOf("owner", { payments: { confirm } } as unknown as Partial<Svc>);
    await commands.confirmPayment(ctx, form({ paymentId: PAY, statementFileId: FILE }));
    expect(confirm).toHaveBeenCalledWith({ paymentId: PAY }, expect.anything(), ctx.rt);
  });
});

describe("purchases and cancellation", () => {
  const ok = {
    vendorId: VENDOR,
    qty: "1",
    amountSum: "100",
    paidVia: "bank_transfer",
    receiptKind: "fiscal",
    receiptNo: "A",
  };

  it("a purchase needs the shop, the quantity, the way of paying, the kind of receipt, and whole sums", async () => {
    const owner = ctxOf("owner", none);
    await refused(() => commands.recordPurchase(owner, ORDER, form({ ...ok, vendorId: "" })), "магазин");
    await refused(() => commands.recordPurchase(owner, ORDER, form({ ...ok, qty: "x" })), "Количество");
    await refused(() => commands.recordPurchase(owner, ORDER, form({ ...ok, paidVia: "cash" })), "чем оплачено");
    await refused(() => commands.recordPurchase(owner, ORDER, form({ ...ok, receiptKind: "napkin" })), "вид чека");
    await refused(() => commands.recordPurchase(owner, ORDER, form({ ...ok, discountSum: "1,5" })), "Скидка");
    await refused(
      () => commands.recordPurchase(owner, ORDER, form({ ...ok, vendorWarrantyMonths: "год" })),
      "Гарантия",
    );
  });

  it("a purchase with a discount, a product and no receipt goes to the services as it is", async () => {
    const record = vi.fn(async () => ({ ok: true as const, status: "purchasing" as const, purchaseId: "p9" }));
    const ctx = ctxOf("owner", { purchases: { record } } as unknown as Partial<Svc>);
    const r = await commands.recordPurchase(
      ctx,
      ORDER,
      form({
        vendorId: VENDOR,
        qty: "2",
        amountSum: "500 000",
        discountSum: "10 000",
        productId: ACT,
        paidVia: "corp_card",
        receiptKind: "none_with_consent",
      }),
    );
    expect(r).toMatchObject({ ok: true, id: "p9" });
    expect(record).toHaveBeenCalledWith(
      {
        orderId: ORDER,
        vendorId: VENDOR,
        productId: ACT,
        qty: 2,
        amountSum: 500_000,
        discountSum: 10_000,
        paidVia: "corp_card",
        receiptKind: "none_with_consent",
        receiptFileIds: [],
      },
      expect.anything(),
      ctx.rt,
    );
  });

  it("the share of the assembly is whole percent up to 100 and the losses are whole sums", async () => {
    const owner = ctxOf("owner", none);
    await refused(
      () => commands.runEvent(owner, ORDER, "CANCEL", form({ reason: "x", assemblyDonePercent: "101" })),
      "от 0 до 100",
    );
    await refused(
      () => commands.runEvent(owner, ORDER, "CANCEL", form({ reason: "x", assemblyDonePercent: "много" })),
      "от 0 до 100",
    );
    await refused(
      () => commands.runEvent(owner, ORDER, "CANCEL", form({ reason: "x", documentedLosses: "-5" })),
      "Потери",
    );
  });

  it("cancels with the reason alone when there is nothing else to say", async () => {
    const cancel = vi.fn(async () => ({ ok: true as const, status: "cancelling" as const }));
    const ctx = ctxOf("owner", { orders: { cancel } } as unknown as Partial<Svc>);
    await commands.runEvent(ctx, ORDER, "CANCEL", form({ reason: "Передумал" }));
    expect(cancel).toHaveBeenCalledWith({ orderId: ORDER, reason: "Передумал" }, expect.anything(), ctx.rt);
  });

  it("an event that no screen sends is not sent", async () => {
    const r = await commands.runEvent(ctxOf("owner", none), ORDER, "CLOSE", form({}));
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("не отсюда");
  });
});

describe("the report, the acts, the requests, the documents", () => {
  it("what is missing is named", async () => {
    const owner = ctxOf("owner", none);
    await refused(() => commands.sendReport(owner, ORDER, form({})), "сформируйте отчёт");
    await refused(() => commands.resolveObjection(owner, ORDER, form({})), "ответ");
    await refused(() => commands.generateAct(owner, ORDER, form({ kind: "napkin" })), "вид акта");
    await refused(() => commands.signPaperAct(owner, form({ fileId: FILE })), "Акт не выбран");
    await refused(() => commands.bindLead(owner, LEAD, form({})), "клиента");
    await refused(() => commands.recordConsent(owner, ORDER, CUSTOMER, form({})), "вид согласия");
    await refused(() => commands.requestPdf(owner, ORDER, "NV-1", form({ doc: "napkin" })), "документ");
  });

  it("an act of a kind that needs no lines is drawn without them, and the lines are cut from their quantities", async () => {
    const generate = vi.fn(async () => ({ actId: ACT }));
    const ctx = ctxOf("owner", { acts: { generate } } as unknown as Partial<Svc>);
    await commands.generateAct(ctx, ORDER, form({ kind: "handover" }));
    expect(generate).toHaveBeenCalledWith({ orderId: ORDER, kind: "handover" }, expect.anything(), ctx.rt);
    expect(commands.parseActLines("Кулер ×3\n\n  SSD x 2 \nПроцессор")).toEqual([
      { title: "Кулер", qty: 3 },
      { title: "SSD", qty: 2 },
      { title: "Процессор", qty: 1 },
    ]);
    expect(commands.parseActLines("")).toEqual([]);
  });

  it("the request for a PDF queues the job of the worker, with the act when there is one; the assistant may ask", async () => {
    const enqueue = vi.fn(async () => ({ id: "j1", duplicate: false }));
    const ctx = ctxOf("assistant", { outbox: { enqueue } } as unknown as Partial<Svc>);
    expect((await commands.requestPdf(ctx, ORDER, "NV-2026-0001", form({ doc: "act_handover", actId: ACT }))).ok).toBe(
      true,
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "job",
        payload: { job: "pdf.render", orderId: ORDER, orderNumber: "NV-2026-0001", doc: "act_handover", actId: ACT },
      }),
      {},
      ctx.rt,
    );
    await commands.requestPdf(ctx, ORDER, "NV-2026-0001", form({ doc: "quote" }));
    const payload = (enqueue.mock.calls[1] as unknown as [{ payload: Record<string, unknown> }])[0].payload;
    expect(payload).not.toHaveProperty("actId");
    const translator = ctxOf("translator", { outbox: { enqueue } } as unknown as Partial<Svc>);
    expect(await commands.requestPdf(translator, ORDER, "NV-1", form({ doc: "quote" }))).toMatchObject({
      denied: true,
    });
  });

  it("an exception of the services becomes text, and the person is not told what it was", async () => {
    const boom = vi.fn(async () => {
      throw new Error("db password leaked 1234");
    });
    const ctx = ctxOf("owner", { reports: { generate: boom } } as unknown as Partial<Svc>);
    const r = await commands.generateReport(ctx, ORDER);
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain("1234");
  });

  it("an unexpected exception is written to the log of the server with its command, the expected ones are not", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = new Error("connection terminated");
      const ctx = ctxOf("owner", {
        payments: { confirm: vi.fn(async () => Promise.reject(failure)) },
        reports: {
          generate: vi.fn(async () => {
            throw orders.ValidationError.of("orderId", "order_required", "order required");
          }),
        },
      } as unknown as Partial<Svc>);
      const r = await commands.confirmPayment(ctx, form({ paymentId: PAY, fiscalReceiptNo: "1" }));
      expect(r).toMatchObject({ ok: false, message: SERVICE_FALLBACK });
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).toContain("payments.write");
      expect(log.mock.calls[0]?.[1]).toBe(failure);
      await commands.generateReport(ctx, ORDER);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
