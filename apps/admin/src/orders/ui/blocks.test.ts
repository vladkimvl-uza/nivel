// The blocks of the card drawn on the server, as the browser gets them: what each role sees and what it does not.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "../../auth/roles.ts";
import { cardOf, ID, paymentOf, purchaseOf, quoteOf } from "../test-support/card.ts";

vi.mock("../actions.ts", () => {
  const action = () => vi.fn(async () => ({}));
  return {
    runEventAction: action(),
    rebuildQuoteAction: action(),
    sendQuoteAction: action(),
    expectPaymentAction: action(),
    confirmPaymentAction: action(),
    voidPaymentAction: action(),
    reversePaymentAction: action(),
    recordPurchaseAction: action(),
    recordConsentAction: action(),
    generateReportAction: action(),
    sendReportAction: action(),
    resolveObjectionAction: action(),
    generateActAction: action(),
    signActAction: action(),
    savePassportAction: action(),
    openWarrantyAction: action(),
    advanceWarrantyAction: action(),
    bindLeadAction: action(),
    convertLeadAction: action(),
    addOtherIncomeAction: action(),
    requestPdfAction: action(),
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/orders" }));
vi.mock("../../auth/actions.ts", () => ({ signOutAction: vi.fn() }));

const { CardHeader, MoneyBlock } = await import("./CardHeader.tsx");
const { ActsBlock, PassportBlock, PdfBlock, ReportBlock, WarrantyBlock } = await import("./DocumentsBlocks.tsx");
const { NextSteps } = await import("./NextSteps.tsx");
const { OrdersShell } = await import("./OrdersShell.tsx");
const { PaymentsBlock } = await import("./PaymentsBlock.tsx");
const { PurchasesBlock } = await import("./PurchasesBlock.tsx");
const { QuoteBlock } = await import("./QuoteBlock.tsx");
const { ThresholdBlock } = await import("./ThresholdBlock.tsx");
const { Timeline } = await import("./Timeline.tsx");

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const confirmed = (over: Partial<ReturnType<typeof paymentOf>>) =>
  paymentOf({ status: "confirmed", confirmedAt: new Date("2026-10-12T05:00:00Z"), ...over });

describe("the head of the card", () => {
  it("names the order, the customer, the status and the stub of the offer", () => {
    const out = html(h(CardHeader, { card: cardOf("accepted", { offer: { uz: "stub", ru: "published" } }) }));
    expect(out).toContain("NV-2026-0001 · Азиз Каримов");
    expect(out).toContain('data-status="accepted"');
    expect(out).toContain("Принято: ждём деньги");
    expect(out).toContain("оферта: заглушка");
    expect(out).toContain("@aziz_k");
    expect(out).toContain("L-2026-0001");
  });

  it("hides the phone unless the card holds it and marks an erased customer", () => {
    const base = cardOf("accepted");
    expect(html(h(CardHeader, { card: base }))).not.toContain("+998");
    const withPhone = cardOf("accepted", { customer: { ...base.customer, phone: "+998901234567", erased: true } });
    const out = html(h(CardHeader, { card: withPhone }));
    expect(out).toContain("+998901234567");
    expect(out).toContain("обезличен");
  });

  it("shows the terms the automaton stored", () => {
    const base = cardOf("report_sent");
    const out = html(
      h(CardHeader, {
        card: {
          ...base,
          order: {
            ...base.order,
            acceptedAt: new Date("2026-10-12T05:00:00Z"),
            reportDueAt: new Date("2026-10-13T05:00:00Z"),
            objectionUntil: new Date("2026-10-16T05:00:00Z"),
            refundDueAt: new Date("2026-10-19T05:00:00Z"),
            warrantyUntil: new Date("2027-10-12T05:00:00Z"),
            purchaseNotBefore: new Date("2026-10-13T05:00:00Z"),
          },
        },
      }),
    );
    for (const text of [
      "Принят клиентом",
      "Отчёт к сдаче",
      "Возражения до",
      "Возврат до",
      "Гарантия до",
      "Закупка не раньше",
    ]) {
      expect(out).toContain(text);
    }
    expect(out).toContain("16.10.2026 10:00");
  });
});

describe("the money block", () => {
  it("shows what came, what was bought, what went back, the limit, and a meter within the limit", () => {
    const card = cardOf("purchasing", {
      money: {
        fundsReceived: 12_210_000,
        receiptsTotal: 2_800_000,
        refunded: 0,
        documentedLosses: 50_000,
        hasLimitOverrunConsent: true,
      },
    });
    const out = html(h(MoneyBlock, { card }));
    expect(out).toContain("12\u00a0210\u00a0000\u00a0сум");
    expect(out).toContain("2\u00a0800\u00a0000\u00a0сум");
    expect(out).toContain('data-testid="spend-meter"');
    expect(out).toContain('max="12210000"');
    expect(out).toContain('value="2800000"');
    expect(out).toContain("Потери с документами");
    expect(out).toContain("есть");
  });

  it("does not draw the meter for an order without an estimate", () => {
    const out = html(h(MoneyBlock, { card: cardOf("estimate_draft", { quote: null }) }));
    expect(out).not.toContain("spend-meter");
    expect(out).toContain("—");
  });
});

describe("the estimate", () => {
  it("shows the totals saved by the server, the verdict, the lines and who buys them", () => {
    const out = html(h(QuoteBlock, { card: cardOf("estimate_draft"), canEdit: true }));
    expect(out).toContain("12\u00a0210\u00a0000\u00a0сум");
    expect(out).toContain("1\u00a0777\u00a0500\u00a0сум");
    expect(out).toContain("13\u00a0987\u00a0500\u00a0сум");
    expect(out).toContain("Совместимо");
    expect(out).toContain("полный цикл");
    expect(out).toContain("ИП из денег клиента");
    expect(out).toContain("работа исполнителя");
    expect(out).toContain("15 %");
    expect(out).toContain("Открыть редактор сметы");
  });

  it("offers the editor only to who may edit, and a start when there is no estimate", () => {
    expect(html(h(QuoteBlock, { card: cardOf("estimate_draft"), canEdit: false }))).not.toContain("open-quote-editor");
    const empty = html(h(QuoteBlock, { card: cardOf("estimate_draft", { quote: null }), canEdit: true }));
    expect(empty).toContain("Сметы ещё нет");
    expect(empty).toContain("Составить смету");
  });

  it("explains the warnings of the calculation in Russian, without the keys", () => {
    const quote = quoteOf({
      totals: {
        ...quoteOf().totals,
        warnings: [
          { key: "quote.price_uncertain", params: { productId: "x" } },
          { key: "quote.demo_data" },
          { key: "quote.new_one" },
        ],
      },
    });
    const out = html(h(QuoteBlock, { card: cardOf("estimate_draft", { quote }), canEdit: false }));
    expect(out).toContain("Цена позиции ненадёжна");
    expect(out).toContain("демонстрационные данные");
    expect(out).toContain("Предупреждение расчёта");
    expect(out).not.toContain("quote.price_uncertain");
  });

  it("shows the term of a sent estimate", () => {
    const quote = quoteOf({
      status: "sent",
      validUntil: new Date("2026-10-13T05:00:00Z"),
      manuallyCheckedAt: new Date("2026-10-12T05:00:00Z"),
    });
    const out = html(h(QuoteBlock, { card: cardOf("estimate_sent", { quote }), canEdit: false }));
    expect(out).toContain("отправлена");
    expect(out).toContain("до 13.10.2026 10:00");
    expect(out).toContain("Проверено вручную");
  });
});

describe("next steps", () => {
  const steps = (status: Parameters<typeof cardOf>[0], role: Role, over: Parameters<typeof cardOf>[1] = {}) =>
    html(h(NextSteps, { card: cardOf(status, over), role }));

  it("offers the owner the money steps of the status, each as a form with its own test id", () => {
    const out = steps("accepted", "owner", { payments: [confirmed({ id: ID(11), fiscalReceiptNo: "FR-1" })] });
    for (const type of ["FEE_PREPAID", "FUNDS_RECEIVED", "MEETING_DONE", "START_PURCHASE", "CANCEL"]) {
      expect(out, type).toContain(`data-testid="event-${type}"`);
    }
    expect(out).toContain("Платёж аванса");
    expect(out).toContain("FR-1");
  });

  it("gives the assistant no step in a money status and says so", () => {
    const out = steps("accepted", "assistant");
    expect(out).not.toContain('data-testid="event-');
    expect(out).toContain("Сейчас по этому заказу шагов нет");
  });

  it("gives the assistant the assembly steps and nothing of money", () => {
    const out = steps("assembling", "assistant");
    expect(out).toContain("Сборка закончена");
    expect(out).not.toContain("Отменить заказ");
    const tests = steps("testing", "assistant");
    expect(tests).toContain("Тесты пройдены");
  });

  it("says who is waited for when the owner has no step", () => {
    const waiting = steps("estimate_sent", "owner");
    expect(waiting).toContain("Ждём клиента");
    expect(waiting).not.toContain("event-PODBOR_DELIVERED");
    const out = steps("closed", "owner");
    expect(out).toContain('data-testid="no-steps"');
    expect(out).toContain("Заказ закрыт");
  });

  it("gives nobody else any step", () => {
    expect(steps("accepted", "accountant")).toContain("У вашей роли нет действий");
    expect(steps("accepted", "translator")).toContain("У вашей роли нет действий");
  });

  it("links the estimate, the purchases and the report to their own places", () => {
    expect(steps("estimate_draft", "owner")).toContain(`/orders/${ID(1)}/quote`);
    expect(steps("purchasing", "owner")).toContain('href="#purchases"');
    expect(steps("report_due", "owner")).toContain('href="#report"');
  });

  it("asks for the time of the money with the last confirmed transfer as the default, and lists only confirmed transfers", () => {
    const out = steps("accepted", "owner", {
      payments: [
        confirmed({
          id: ID(12),
          kind: "purchase_funds",
          method: "bank_transfer_ip",
          amountSum: 12_210_000,
          bankDocNo: "PP-7",
        }),
        paymentOf({
          id: ID(13),
          kind: "purchase_funds",
          method: "bank_transfer_ip",
          amountSum: 1_000,
          status: "expected",
        }),
      ],
    });
    expect(out).toContain("PP-7");
    expect(out).not.toContain("1\u00a0000\u00a0сум");
    expect(out).toContain('value="2026-10-12T10:00"');
  });

  it("asks for the signed acts only, the confirmed final payment and the refund of the remainder", () => {
    const signed = {
      id: ID(21),
      kind: "handover",
      lines: [],
      signedAt: new Date("2026-10-12T05:00:00Z"),
      signedVia: "paper_photo",
      evidenceFileId: null,
      createdAt: new Date(),
      pdf: { uz: null, ru: null },
    };
    const open = { ...signed, id: ID(22), signedAt: null, signedVia: null };
    const out = steps("delivering", "owner", {
      acts: [signed, open],
      payments: [confirmed({ id: ID(14), kind: "fee_final", amountSum: 1_244_250, fiscalReceiptNo: "FR-2" })],
    });
    expect(out).toContain("Акт сдачи (подписанный)");
    expect(out).toContain(`value="${ID(21)}"`);
    expect(out).not.toContain(`value="${ID(22)}"`);
    expect(out).toContain("FR-2");
    const settle = steps("report_sent", "owner", {
      payments: [
        confirmed({
          id: ID(15),
          kind: "remainder_refund",
          direction: "out",
          method: "bank_transfer_out",
          bankDocNo: "PP-9",
        }),
      ],
    });
    expect(settle).toContain("Платёж возврата остатка");
    expect(settle).toContain("PP-9");
  });

  it("asks for the cancellation reason, the share of the assembly and the losses", () => {
    const out = steps("assembling", "owner");
    expect(out).toContain("Причина (по заявлению клиента)");
    expect(out).toContain("Сборка выполнена на, %");
    expect(out).toContain("Потери с документами, сумов");
    expect(out).not.toContain("feeToRefund");
  });
});

describe("payments", () => {
  const card = cardOf("accepted", {
    payments: [
      paymentOf({ id: ID(31) }),
      paymentOf({ id: ID(32), kind: "purchase_funds", method: "bank_transfer_ip", amountSum: 12_210_000 }),
      confirmed({ id: ID(33), kind: "fee_final", fiscalReceiptNo: "FR-33", amountSum: 1_244_250 }),
      confirmed({
        id: ID(34),
        kind: "fee_refund",
        direction: "out",
        method: "bank_transfer_out",
        amountSum: -100,
        reversalOf: ID(33),
      }),
    ],
  });

  it("shows the table to everybody and the actions only to who may write", () => {
    const read = html(h(PaymentsBlock, { card, canWrite: false }));
    expect(read).toContain("QR Xolis с чеком");
    expect(read).toContain("FR-33");
    expect(read).not.toContain("Действия");
    expect(read).not.toContain("Подтвердить платёж");
    expect(read).not.toContain("Ожидать платёж");
  });

  it("asks for the fiscal receipt of a fee and for the bank document of the funds", () => {
    const out = html(h(PaymentsBlock, { card, canWrite: true }));
    expect(out).toContain("Номер фискального чека");
    expect(out).toContain("Номер платёжного документа банка");
    expect(out).toContain("Плательщик — другой человек");
    expect(out).toContain("Исправить сторно");
    expect(out).toContain("сторно");
    expect(out).toContain("Ожидать платёж");
    // The form of a new expectation names every kind and every way, so that a wrong pair can be tried and refused.
    expect(out).toContain("Деньги на закупку");
    expect(out).toContain("Перевод на счёт ИП");
  });

  it("says that there are no payments", () => {
    expect(html(h(PaymentsBlock, { card: cardOf("estimate_draft"), canWrite: false }))).toContain("Платежей нет");
  });
});

describe("purchases", () => {
  const vendors = [{ id: ID(41), name: "Test shop" }];

  it("lists the purchases with the receipts, the photos, the serials and the ESF term", () => {
    const card = cardOf("purchasing", {
      purchases: [
        purchaseOf(),
        purchaseOf({
          id: ID(601),
          receiptKind: "esf",
          receiptNo: null,
          esfNo: "ESF-7",
          esfStatus: "pending",
          esfDue: "2026-10-22",
          discountSum: 10_000,
          serials: [],
          vendorWarrantyUntil: null,
          files: [],
        }),
      ],
    });
    const out = html(h(PurchasesBlock, { card, vendors, canRecord: true, canConsent: true }));
    expect(out).toContain("Фискальный чек № CH-1");
    expect(out).toContain("ЭСФ № ESF-7");
    expect(out).toContain("ждёт подписи до 22.10.2026");
    expect(out).toContain("скидка 10\u00a0000\u00a0сум");
    expect(out).toContain(`href="/orders/files/${ID(700)}"`);
    expect(out).toContain("SN1");
  });

  it("draws the form of a purchase with the camera field and the hint about HEIC while the order is in purchases", () => {
    const out = html(h(PurchasesBlock, { card: cardOf("purchasing"), vendors, canRecord: true, canConsent: true }));
    expect(out).toContain('data-testid="record-purchase"');
    expect(out).toContain('capture="environment"');
    expect(out).toContain("HEIC");
    expect(out).toContain("Test shop");
    expect(out).toContain("Ryzen 5 7600");
    expect(out).toContain("Согласие клиента");
  });

  it("gives the assistant the form of a purchase and not the consents", () => {
    const out = html(h(PurchasesBlock, { card: cardOf("purchasing"), vendors, canRecord: true, canConsent: false }));
    expect(out).toContain('data-testid="record-purchase"');
    expect(out).not.toContain("consent-details");
  });

  it("draws no form outside the purchases, and none for a role that may not record", () => {
    expect(
      html(h(PurchasesBlock, { card: cardOf("report_due"), vendors, canRecord: true, canConsent: true })),
    ).not.toContain("record-purchase");
    expect(
      html(h(PurchasesBlock, { card: cardOf("purchasing"), vendors, canRecord: false, canConsent: false })),
    ).not.toContain("record-purchase");
  });

  it("lists the consents already given", () => {
    const card = cardOf("purchasing", {
      consents: [{ kind: "limit_overrun", granted: true, at: new Date("2026-10-12T05:00:00Z") }],
    });
    expect(html(h(PurchasesBlock, { card, vendors, canRecord: true, canConsent: true }))).toContain(
      "Превышение лимита закупки: есть",
    );
  });
});

describe("the report, the acts, the passport, the warranty, the documents", () => {
  const sentReport = {
    id: ID(51),
    version: 1,
    receivedSum: 12_210_000,
    spentSum: 11_850_000,
    discountsSum: 0,
    remainderSum: 360_000,
    generatedAt: new Date("2026-10-12T05:00:00Z"),
    sentAt: null,
    dueAt: null,
    objectionUntil: null,
    objection: null,
    acceptedAt: null,
    deemedAcceptedAt: null,
    pdf: { uz: null, ru: null },
  };

  it("lets the owner make and send the report while the purchases run, and nobody else", () => {
    const card = cardOf("report_due", { reports: [sentReport] });
    const owner = html(h(ReportBlock, { card, canWrite: true }));
    expect(owner).toContain("Сформировать отчёт");
    expect(owner).toContain("Отправить отчёт клиенту");
    expect(owner).toContain("360\u00a0000\u00a0сум");
    const helper = html(h(ReportBlock, { card, canWrite: false }));
    expect(helper).not.toContain("Сформировать отчёт");
    expect(helper).not.toContain("Отправить отчёт клиенту");
    expect(helper).toContain("360\u00a0000\u00a0сум");
  });

  it("is absent when there is no report and nothing to make", () => {
    expect(html(h(ReportBlock, { card: cardOf("estimate_draft"), canWrite: true }))).toBe("");
    expect(html(h(ReportBlock, { card: cardOf("accepted"), canWrite: false }))).toBe("");
  });

  it("shows an open objection and the form of the answer for the owner", () => {
    const card = cardOf("report_sent", {
      reports: [
        {
          ...sentReport,
          sentAt: new Date("2026-10-12T05:00:00Z"),
          objection: { text: "Не сходится сумма", resolved: false },
        },
      ],
    });
    const out = html(h(ReportBlock, { card, canWrite: true }));
    expect(out).toContain("Не сходится сумма");
    expect(out).toContain("Записать ответ клиенту");
    expect(html(h(ReportBlock, { card, canWrite: false }))).not.toContain("Записать ответ клиенту");
  });

  it("does not show an answered objection as open", () => {
    const card = cardOf("report_sent", {
      reports: [{ ...sentReport, objection: { text: "x", note: "y", resolved: true } }],
    });
    expect(html(h(ReportBlock, { card, canWrite: true }))).not.toContain('data-testid="objection"');
  });

  it("lists the acts and lets the owner sign a paper one with a photo, the assistant only draw it", () => {
    const act = {
      id: ID(61),
      kind: "material_acceptance",
      lines: [{ title: "SSD", qty: 2 }],
      signedAt: null,
      signedVia: null,
      evidenceFileId: null,
      createdAt: new Date(),
      pdf: { uz: null, ru: null },
    };
    const card = cardOf("settled", { acts: [act] });
    const owner = html(h(ActsBlock, { card, canGenerate: true, canSign: true }));
    expect(owner).toContain("SSD × 2");
    expect(owner).toContain("ждёт подписи");
    expect(owner).toContain("Подписать бумажный акт");
    const helper = html(h(ActsBlock, { card, canGenerate: true, canSign: false }));
    expect(helper).toContain("Составить акт");
    expect(helper).not.toContain("Подписать бумажный акт");
    const signed = cardOf("settled", {
      acts: [{ ...act, signedAt: new Date("2026-10-12T05:00:00Z"), signedVia: "paper_photo", evidenceFileId: ID(62) }],
    });
    const out = html(h(ActsBlock, { card: signed, canGenerate: false, canSign: true }));
    expect(out).toContain('data-signed="yes"');
    expect(out).toContain("бумажный акт, фото");
    expect(out).toContain(`/orders/files/${ID(62)}`);
    expect(out).not.toContain("Подписать бумажный акт");
  });

  it("draws the passport form while the PC is assembled and tested, with the values it holds", () => {
    const passport = {
      serials: { Процессор: "SN1" },
      biosVersion: "F14",
      os: null,
      tests: { minutes: 420, tool: "OCCT", errors: [] },
      photoIds: [ID(71)],
      sealPhotoIds: [],
      labelCode: null,
      notes: null,
      pdf: { uz: null, ru: null },
    };
    const editable = html(h(PassportBlock, { card: cardOf("testing", { passport }), canWrite: true }));
    expect(editable).toContain("Изменить паспорт");
    expect(editable).toContain("Процессор: SN1");
    expect(editable).toContain("420 мин");
    expect(editable).toContain("ошибок нет");
    expect(editable).toContain("Фото серийных номеров и пломб");
    const readOnly = html(h(PassportBlock, { card: cardOf("handed_over", { passport }), canWrite: true }));
    expect(readOnly).not.toContain("Изменить паспорт");
    expect(readOnly).toContain("420 мин");
    expect(html(h(PassportBlock, { card: cardOf("estimate_draft"), canWrite: true }))).toBe("");
    expect(html(h(PassportBlock, { card: cardOf("assembling"), canWrite: true }))).toContain("Заполнить паспорт");
    expect(html(h(PassportBlock, { card: cardOf("assembling"), canWrite: false }))).toBe("");
  });

  it("shows the errors of a test and the warranty cases of a handed over order", () => {
    const passport = {
      serials: {},
      biosVersion: null,
      os: null,
      tests: { minutes: 100, errors: ["Перегрев"] },
      photoIds: [],
      sealPhotoIds: [],
      labelCode: null,
      notes: null,
      pdf: { uz: null, ru: null },
    };
    expect(html(h(PassportBlock, { card: cardOf("ready", { passport }), canWrite: false }))).toContain(
      "ошибки: Перегрев",
    );
    const at = new Date("2026-10-12T05:00:00Z");
    const kase = {
      id: ID(81),
      number: "G-2026-0001",
      status: "rejected",
      description: "Залив",
      openedAt: at,
      dueReply: at,
      dueDiagnosis: at,
      dueFix: at,
      clientFault: "liquid",
      closedAt: null,
    };
    const out = html(h(WarrantyBlock, { card: cardOf("handed_over", { warranty: [kase] }), canWrite: true }));
    expect(out).toContain("G-2026-0001");
    expect(out).toContain("отказ");
    expect(out).toContain("жидкость");
    expect(out).toContain("Открыть гарантийный случай");
    expect(
      html(h(WarrantyBlock, { card: cardOf("handed_over", { warranty: [kase] }), canWrite: false })),
    ).not.toContain("Следующий шаг");
    expect(html(h(WarrantyBlock, { card: cardOf("purchasing"), canWrite: true }))).toBe("");
  });

  it("draws the PDF block with the files that exist and a button to ask the worker for the rest", () => {
    const card = cardOf("handed_over", {
      quote: quoteOf({ pdf: { uz: ID(91), ru: null } }),
      acts: [
        {
          id: ID(92),
          kind: "handover",
          lines: [],
          signedAt: null,
          signedVia: null,
          evidenceFileId: null,
          createdAt: new Date(),
          pdf: { uz: null, ru: null },
        },
      ],
    });
    const out = html(h(PdfBlock, { card, canRender: true }));
    expect(out).toContain(`/orders/files/${ID(91)}`);
    expect(out).toContain("ru ещё нет");
    expect(out).toContain('data-testid="render-quote"');
    expect(out).toContain('data-testid="render-act_handover"');
    expect(html(h(PdfBlock, { card, canRender: false }))).not.toContain("Сформировать заново");
    expect(html(h(PdfBlock, { card: cardOf("estimate_draft", { quote: null }), canRender: true }))).toContain(
      "Документов для заказа пока нет",
    );
  });
});

describe("the chronology and the threshold", () => {
  it("writes the events of the journal in Russian with the change of the status", () => {
    const at = new Date("2026-10-12T05:00:00Z");
    const card = cardOf("closed", {
      events: [
        {
          orderId: ID(1),
          seq: 1,
          at,
          actorKind: "owner",
          actorId: "u",
          event: { type: "SEND_ESTIMATE" },
          fromStatus: "estimate_draft",
          toStatus: "estimate_sent",
          guardSnapshot: null,
        },
        {
          orderId: ID(1),
          seq: 2,
          at,
          actorKind: "owner",
          actorId: "u",
          event: { type: "FEE_PREPAID" },
          fromStatus: "accepted",
          toStatus: "accepted",
          guardSnapshot: null,
        },
        {
          orderId: ID(1),
          seq: 3,
          at,
          actorKind: "system",
          actorId: "system",
          event: { type: "CLOSE" },
          fromStatus: "handed_over",
          toStatus: "closed",
          guardSnapshot: null,
        },
      ] as never,
    });
    const out = html(h(Timeline, { card }));
    expect(out).toContain("Смета отправлена клиенту");
    expect(out).toContain("Смета в работе → Смета отправлена");
    expect(out).toContain("Аванс платы получен");
    expect(out).toContain("система");
    expect(out).toContain("Заказ закрыт");
    expect(html(h(Timeline, { card: cardOf("estimate_draft") }))).toContain("Событий нет");
  });

  it("draws the status of the threshold as the domain counted it", () => {
    const status = {
      year: 2026,
      limit: 164_383_561,
      volume: 100_000_000,
      committed: 20_000_000,
      shareBp: 6083,
      projectedShareBp: 7300,
      crossedAlerts: [6000],
      overPlanCap: true,
      remaining: 64_383_561,
    };
    const out = html(h(ThresholdBlock, { status: status as never }));
    expect(out).toContain("164\u00a0383\u00a0561\u00a0сум");
    expect(out).toContain("60,83 %");
    expect(out).toContain("73 %");
    expect(out).toContain("60 %");
    expect(out).toContain("прогноз выше плана");
    expect(
      html(h(ThresholdBlock, { status: { ...status, crossedAlerts: [], overPlanCap: false } as never, compact: true })),
    ).toContain("нет");
  });
});

describe("the frame", () => {
  const user = (role: Role) => ({
    id: "u",
    email: "u@nivel.test",
    role,
    telegramUserId: null,
    sessionExpiresAt: new Date(),
  });

  it("puts the sections of the orders in front of the sections of the base admin, without doubles", () => {
    const out = html(h(OrdersShell, { user: user("owner"), children: "тело" }));
    const order = ["Сводка", "Заявки", "Заказы", "Порог и учёт", "Каталог", "Настройки", "Журнал"].map((t) =>
      out.indexOf(`>${t}<`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("тело");
  });

  it("shows the assistant only what the assistant may open", () => {
    const out = html(h(OrdersShell, { user: user("assistant"), children: null }));
    expect(out).toContain(">Заявки<");
    expect(out).not.toContain(">Порог и учёт<");
    expect(out).not.toContain(">Журнал<");
  });
});
