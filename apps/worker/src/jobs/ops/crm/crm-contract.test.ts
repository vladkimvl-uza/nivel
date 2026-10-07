// The contract with the CRM, checked against the CRM itself: the events the worker builds are signed the way the worker signs them and
// handed to `doPost` of the real script of tools/crm-sheets on the mock of Apps Script (the same mock its own tests use). An event
// that the script would refuse (a field it cannot map, a wrong signature, a stale stamp) fails here, not in the owner's book.
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  envelope,
  type LeadFacts,
  leadCreatedData,
  type OrderChangeFacts,
  orderStatusChangedData,
  type PaymentFacts,
  type PurchaseFacts,
  paymentConfirmedData,
  purchaseRecordedData,
  signedRequest,
  type WarrantyFacts,
  warrantyCaseOpenedData,
} from "./events.ts";

const NOW = new Date("2026-11-03T11:00:00+05:00");
const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret
const URL_BASE = "https://script.google.com/macros/s/TEST/exec";

// biome-ignore lint/suspicious/noExplicitAny: the mock of Apps Script is a plain ES module without types
let project: any;
let n = 0;
const read = (table: string): Record<string, unknown>[] => project.call("nvReadTable", table);

beforeAll(async () => {
  const href = pathToFileURL(
    fileURLToPath(new URL("../../../../../../tools/crm-sheets/scripts/env.mjs", import.meta.url)),
  ).href;
  const { createProject } = await import(/* @vite-ignore */ href);
  project = createProject({ now: NOW, scriptProps: { NIVEL_HMAC_SECRET: SECRET, OWNER_EMAIL: "owner@example.com" } });
  project.call("nvSetup");
}, 180_000);

beforeEach(() => {
  project.env.now = NOW;
  project.env.cache.clear();
  project.env.mails.length = 0;
});

/** What the worker does: the envelope with the id of the outbox row, signed at `now`, as a request of `doPost`. */
function send(
  type: Parameters<typeof envelope>[0]["type"],
  data: Record<string, unknown>,
  o: { now?: Date; env?: string } = {},
) {
  n += 1;
  const now = o.now ?? NOW;
  const env = envelope({
    id: `0198a000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    type,
    env: o.env ?? "production",
    occurredAt: now,
    sentAt: now,
    data,
  });
  const req = signedRequest(URL_BASE, SECRET, env, now);
  const url = new URL(req.url);
  const out = project.call("doPost", {
    postData: { contents: req.body, type: "application/json" },
    parameter: Object.fromEntries(url.searchParams),
    parameters: {},
  });
  return { answer: JSON.parse(out.getContent()) as Record<string, unknown>, id: env.id };
}

const lead = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  number: "L-2026-0201",
  createdAt: new Date("2026-11-03T10:50:00+05:00"),
  channel: "web",
  utm: { utm_source: "instagram", utm_medium: "social", utm_campaign: "reels1", source: "ig_reels_1" },
  lang: "uz",
  district: "Chilonzor",
  scope: "setup",
  wantedBy: "2026-11-20",
  configurationCode: "A1B2C3D4",
  customer: { ref: "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11", displayName: "Dilshod", telegramUsername: "dilshod" },
  ...over,
});

const quote = {
  id: "q-1",
  version: 1,
  componentsSum: 20_000_000,
  outsideScaleSum: 0,
  purchaseLimit: 20_600_000,
  reserveBp: 300,
  reserveSum: 600_000,
  feeTotal: 3_000_000,
  feeCommissionLine: 1_500_000,
  feeWorksLine: 1_500_000,
  feeAdvance: 900_000,
  feeFinal: 2_100_000,
  eligibility: "full_cycle",
  validUntil: new Date("2026-11-04T11:00:00+05:00"),
};

const change = (over: Partial<OrderChangeFacts> = {}): OrderChangeFacts => ({
  number: "NV-2026-0301",
  leadNumber: "L-2026-0201",
  customerRef: "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11",
  kind: "pc",
  seq: 1,
  from: "estimate_draft",
  to: "estimate_sent",
  event: "SEND_ESTIMATE",
  actor: "owner",
  at: new Date("2026-11-03T10:55:00+05:00"),
  flags: { feePrepaid: false, fundsReceived: false, firstOrderMeetingDone: false },
  quote,
  dates: {
    purchaseNotBefore: null,
    reportDueAt: null,
    objectionUntil: null,
    refundDueAt: null,
    warrantyUntil: null,
    podborCreditUntil: null,
  },
  report: null,
  cancel: null,
  ledger: [],
  ...over,
});

describe("the events the worker builds are accepted by the CRM", () => {
  it("lead.created: a request becomes a row of the leads, with the channel of the CRM (web is the site)", () => {
    const r = send("lead.created", leadCreatedData(lead()));
    expect(r.answer).toMatchObject({ ok: true, result: "applied", error: null });
    const row = read("leads").find((l) => l.num === "L-2026-0201");
    expect(row).toMatchObject({
      num: "L-2026-0201",
      channel: "Сайт",
      scope: "Сетап",
      lang: "uz",
      district: "Chilonzor",
    });
  });

  it("lead.created: a request the book has already is taken as done, whatever the id of the event (a request has one number)", () => {
    expect(send("lead.created", leadCreatedData(lead())).answer).toMatchObject({ ok: true, result: "ignored" });
    expect(read("leads").filter((l) => l.num === "L-2026-0201")).toHaveLength(1);
  });

  it("lead.created: every channel the platform has is a channel the CRM knows", () => {
    for (const [i, channel] of (["web", "bot", "tma", "admin", "ai"] as const).entries()) {
      const number = `L-2026-02${String(10 + i)}`;
      expect(send("lead.created", leadCreatedData(lead({ number, channel, customer: null }))).answer).toMatchObject({
        ok: true,
        result: "applied",
      });
    }
  });

  it("lead.created: every scope of the platform is a scope of the CRM", () => {
    for (const [i, scope] of (["pc", "pc_periph", "setup", "podbor"] as const).entries()) {
      const number = `L-2026-02${String(20 + i)}`;
      expect(send("lead.created", leadCreatedData(lead({ number, scope, customer: null }))).answer.ok).toBe(true);
    }
  });

  it("order.status_changed: the first event makes the order, the next ones move it and the older one is only logged", () => {
    expect(send("order.status_changed", orderStatusChangedData(change())).answer).toMatchObject({
      ok: true,
      result: "applied",
    });
    const accepted = change({
      seq: 2,
      from: "estimate_sent",
      to: "accepted",
      event: "ACCEPT",
      actor: "customer",
      at: new Date("2026-11-03T11:00:00+05:00"),
    });
    expect(send("order.status_changed", orderStatusChangedData(accepted)).answer).toMatchObject({
      ok: true,
      result: "applied",
    });
    const row = read("orders").find((o) => o.num === "NV-2026-0301");
    expect(row).toMatchObject({ code: "accepted", kind: "ПК", seq: 2, src: "Платформа", lead: "L-2026-0201" });
    // a delayed event of the past: the CRM keeps the newer state and only writes the journal
    expect(send("order.status_changed", orderStatusChangedData(change())).answer).toMatchObject({
      ok: true,
      result: "stale_seq",
    });
    expect(read("orders").find((o) => o.num === "NV-2026-0301")).toMatchObject({ code: "accepted", seq: 2 });
  });

  it("order.status_changed: the report, the dates, the money flags and the reserve of the handover go to the book", () => {
    const base = change({ number: "NV-2026-0302", seq: 7 });
    const sent = change({
      number: "NV-2026-0302",
      seq: 8,
      from: "purchasing",
      to: "report_sent",
      event: "SEND_REPORT",
      dates: {
        purchaseNotBefore: null,
        reportDueAt: new Date("2026-11-04T10:00:00+05:00"),
        objectionUntil: new Date("2026-11-07T10:00:00+05:00"),
        refundDueAt: new Date("2026-11-10T10:00:00+05:00"),
        warrantyUntil: null,
        podborCreditUntil: null,
      },
      report: { accepted: false, objectionOpen: false },
      flags: { feePrepaid: true, fundsReceived: true, firstOrderMeetingDone: true },
    });
    expect(send("order.status_changed", orderStatusChangedData(base)).answer.ok).toBe(true);
    expect(send("order.status_changed", orderStatusChangedData(sent)).answer).toMatchObject({
      ok: true,
      result: "applied",
    });
    const handed = change({
      number: "NV-2026-0302",
      seq: 9,
      from: "delivering",
      to: "handed_over",
      event: "HANDOVER",
      dates: {
        purchaseNotBefore: null,
        reportDueAt: null,
        objectionUntil: null,
        refundDueAt: null,
        warrantyUntil: new Date("2027-11-03T11:00:00+05:00"),
        podborCreditUntil: null,
      },
      ledger: [{ fund: "warranty", amount: 412_000 }],
    });
    expect(send("order.status_changed", orderStatusChangedData(handed)).answer).toMatchObject({
      ok: true,
      result: "applied",
    });
    const reserve = read("reserves").find((r) => r.ref === "NV-2026-0302");
    expect(reserve).toMatchObject({ fund: "Гарантийный", amount: 412_000, basis: "Взнос при сдаче" });
  });

  it("order.status_changed: a cancellation with its settlement", () => {
    const e = change({
      number: "NV-2026-0303",
      seq: 5,
      from: "accepted",
      to: "cancelling",
      event: "CANCEL",
      cancel: {
        point: "after_accept_before_purchase",
        reason: "Передумал",
        settlement: {
          feeEarned: 600_000,
          feeToRefund: 300_000,
          feeToInvoice: 0,
          fundsToRefund: 20_600_000,
          partsGoTo: "none",
          dueBy: new Date("2026-11-10T11:00:00+05:00"),
        },
      },
    });
    expect(send("order.status_changed", orderStatusChangedData(e)).answer).toMatchObject({
      ok: true,
      result: "applied",
    });
  });

  it("order.status_changed: every status and every event of the automaton is one the CRM has", () => {
    const statuses = [
      "estimate_draft",
      "estimate_sent",
      "estimate_expired",
      "accepted",
      "purchasing",
      "report_due",
      "report_sent",
      "settled",
      "assembling",
      "testing",
      "ready",
      "delivering",
      "handed_over",
      "closed",
      "podbor_delivered",
      "cancelling",
      "cancelled",
    ];
    const events = [
      "SEND_ESTIMATE",
      "EXPIRE",
      "REVISE",
      "ACCEPT",
      "FEE_PREPAID",
      "FUNDS_RECEIVED",
      "MEETING_DONE",
      "START_PURCHASE",
      "PURCHASE_RECORDED",
      "PURCHASE_DONE",
      "SEND_REPORT",
      "OBJECTION",
      "REPORT_ACCEPTED",
      "REPORT_DEEMED_ACCEPTED",
      "REMAINDER_SETTLED",
      "MATERIALS_ACCEPTED",
      "ASSEMBLED",
      "TESTS_PASSED",
      "DISPATCH",
      "HANDOVER",
      "CLOSE",
      "PODBOR_DELIVERED",
      "CANCEL",
      "CANCEL_SETTLED",
    ];
    let seq = 1;
    for (const to of statuses) {
      const e = change({
        number: "NV-2026-0304",
        seq: seq++,
        to,
        event: events[seq % events.length] as string,
        quote: null,
      });
      expect(send("order.status_changed", orderStatusChangedData(e)).answer, to).toMatchObject({ ok: true });
    }
  });

  it("payment.confirmed: the advance of the fee by QR with a fiscal receipt is counted", () => {
    const p: PaymentFacts = {
      paymentId: "0198a111-1111-7222-8333-444455556666",
      orderNumber: "NV-2026-0301",
      kind: "fee_advance",
      direction: "in",
      method: "xolis_qr",
      amountSum: 900_000,
      status: "confirmed",
      fiscalReceiptNo: "FR-1001",
      bankDocNo: null,
      occurredAt: new Date("2026-11-03T11:20:00+05:00"),
      confirmedAt: new Date("2026-11-03T11:25:00+05:00"),
      payerIsCustomer: true,
      reversalOf: null,
    };
    expect(send("payment.confirmed", paymentConfirmedData(p)).answer).toMatchObject({ ok: true, result: "applied" });
    expect(read("payments").find((r) => r.id === p.paymentId)).toMatchObject({
      status: "Подтверждён",
      amount: 900_000,
      kind: "Аванс платы 30 %",
      method: "QR Xolis",
    });
    // the voiding of the same payment (a full reversal) updates the row
    expect(
      send(
        "payment.confirmed",
        paymentConfirmedData({ ...p, status: "void", reversalOf: "0198a111-1111-7222-8333-000000000001" }),
      ).answer.ok,
    ).toBe(true);
    expect(read("payments").find((r) => r.id === p.paymentId)).toMatchObject({ status: "Аннулирован" });
  });

  it("payment.confirmed: the money for the purchases by transfer to the account of the sole proprietor", () => {
    const p: PaymentFacts = {
      paymentId: "0198a111-1111-7222-8333-777788889999",
      orderNumber: "NV-2026-0301",
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: 20_600_000,
      status: "confirmed",
      fiscalReceiptNo: null,
      bankDocNo: "PP-5001",
      occurredAt: new Date("2026-11-03T11:30:00+05:00"),
      confirmedAt: new Date("2026-11-03T11:31:00+05:00"),
      payerIsCustomer: true,
      reversalOf: null,
    };
    expect(send("payment.confirmed", paymentConfirmedData(p)).answer).toMatchObject({ ok: true, result: "applied" });
    expect(read("payments").find((r) => r.id === p.paymentId)).toMatchObject({
      status: "Подтверждён",
      kind: "Деньги на закупку",
      method: "Перевод на счёт ИП",
    });
  });

  it("purchase.recorded: a receipt with the category of the catalog, the shop and the serials", () => {
    const f: PurchaseFacts = {
      purchaseId: "0198a222-1111-7222-8333-444455556666",
      orderNumber: "NV-2026-0301",
      title: "Gigabyte RTX 5060",
      categoryCode: "gpu",
      vendorName: "Mycom",
      qty: 1,
      amountSum: 3_600_000,
      paidVia: "bank_transfer",
      receiptKind: "fiscal",
      receiptNo: "CH-1",
      esfNo: null,
      esfDue: null,
      discountSum: 0,
      bonusNote: null,
      serials: ["SN123"],
      vendorWarrantyMonths: 36,
      vendorWarrantyUntil: "2029-11-03",
      boughtAt: new Date("2026-11-03T12:00:00+05:00"),
      totals: { receiptsTotal: 3_600_000, fundsReceived: 20_600_000, purchaseLimit: 20_600_000 },
    };
    expect(send("purchase.recorded", purchaseRecordedData(f)).answer).toMatchObject({ ok: true, result: "applied" });
    expect(read("purchases").find((r) => r.id === f.purchaseId)).toMatchObject({
      category: "Видеокарта",
      shop: "Mycom",
      amount: 3_600_000,
    });
    // a category the CRM does not know is "Другое", and the event is still taken
    const other = { ...f, purchaseId: "0198a222-1111-7222-8333-000000000002", categoryCode: "teleporter" };
    expect(send("purchase.recorded", purchaseRecordedData(other)).answer.ok).toBe(true);
  });

  it("warranty.case_opened: the case with the terms of the platform", () => {
    const f: WarrantyFacts = {
      number: "G-2026-0033",
      orderNumber: "NV-2026-0301",
      purchaseId: null,
      openedAt: new Date("2026-11-03T12:10:00+05:00"),
      channel: "bot",
      summary: "Не включается",
      status: "opened",
      dueReply: new Date("2026-11-04T12:10:00+05:00"),
      dueDiagnosis: new Date("2026-11-05T12:10:00+05:00"),
      dueLoaner: new Date("2026-11-06T12:10:00+05:00"),
      dueFix: new Date("2026-11-17T12:10:00+05:00"),
    };
    expect(send("warranty.case_opened", warrantyCaseOpenedData(f)).answer).toMatchObject({
      ok: true,
      result: "applied",
    });
    expect(read("warranty").find((r) => r.num === "G-2026-0033")).toMatchObject({ order: "NV-2026-0301" });
  });
});

describe("what a person wrote in a free text does not carry a phone number to the CRM", () => {
  it("masks the phone and the e-mail in the summary of a warranty case and the name of a customer", () => {
    const warranty = warrantyCaseOpenedData({
      number: "G-2026-0033",
      orderNumber: "NV-2026-0301",
      purchaseId: null,
      openedAt: new Date("2026-11-03T12:10:00+05:00"),
      channel: "bot",
      summary: "Не включается, звоните +998 90 123-45-67 или ivan@example.uz",
      status: "opened",
      dueReply: null,
      dueDiagnosis: null,
      dueLoaner: null,
      dueFix: null,
    });
    expect(warranty.summary).toBe("Не включается, звоните <phone> или <email>");
    const lead = leadCreatedData({
      number: "L-2026-0001",
      createdAt: new Date("2026-10-12T09:00:00+05:00"),
      channel: "bot",
      utm: null,
      lang: "ru",
      district: null,
      scope: "pc",
      wantedBy: null,
      configurationCode: null,
      customer: { ref: "c-1", displayName: "Дилшод +998901234567", telegramUsername: "dilshod" },
    }) as { customer: { display_name: string } };
    expect(lead.customer.display_name).toBe("Дилшод <phone>");
  });
});

describe("what the CRM refuses", () => {
  it("answers wrong_env for the other environment, and does not apply the event", () => {
    const r = send("lead.created", leadCreatedData(lead({ number: "L-2026-0290", customer: null })), {
      env: "development",
    });
    expect(r.answer).toMatchObject({ ok: false, error: "wrong_env" });
    expect(read("leads").some((l) => l.num === "L-2026-0290")).toBe(false);
  });

  it("answers stale for a request older than the freshness (the clock of the worker is wrong or the retry was not signed again)", () => {
    const r = send("lead.created", leadCreatedData(lead({ number: "L-2026-0291", customer: null })), {
      now: new Date(NOW.getTime() - 10 * 60_000),
    });
    expect(r.answer).toMatchObject({ ok: false, error: "stale" });
  });
});
