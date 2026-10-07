// The commands of the orders screens: what a form of the admin asks of the services (ARCHITECTURE 4.13, 6.3). Each one
// checks the role, reads the form into the input of a scenario, calls it as the person signed in, and turns the answer
// into text: an answer of the automaton (GuardError) or an exception of the services becomes Russian, never a code.
// Money and statuses are not calculated here (red lines): the sums are the ones the person typed or the services made.
// Framework-free (no `next/*`): server actions in `actions.ts` wrap these; tests give them fake services.

import { UuidSchema } from "@nivel/contracts/orders";
import type { OrderStatus } from "@nivel/domain/order";
import type * as Services from "@nivel/services";
import type { Role } from "../auth/roles.ts";
import type { AuditEntry } from "../auth/store.ts";
import { canDo, type OrdersPermission } from "./access.ts";
import { buildEvent, type FormInput, parseSum, permissionOf } from "./build-event.ts";
import { PDF_FLAG } from "./flags.ts";
import { STATUS_LABEL } from "./labels.ts";
import { explain, guardText } from "./messages.ts";

export type Svc = typeof Services;

/** What a command reads from the database itself, where the services have no scenario to ask. */
export interface Facts {
  /** The customer of the order: the form never names him. */
  customerOf(orderId: string): Promise<string | null>;
  /** The number of the order, as the database holds it. */
  orderNumber(orderId: string): Promise<string | null>;
  /** The order an act belongs to. */
  actOrderId(actId: string): Promise<string | null>;
  /** A switch of unfinished work (`feature.*`): on only when it is exactly `true`. */
  featureOn(key: string): Promise<boolean>;
}

export interface Ctx {
  user: { id: string; role: Role };
  svc: Svc;
  /** The runtime of the services (the admin role of the database), always passed explicitly. */
  rt: Services.orders.Runtime;
  now(): Date;
  facts: Facts;
  /** The journal of the admin: for what the services do not write themselves. */
  audit: { append(entry: AuditEntry): Promise<void> };
  /** Hash of the address of the request, for the journal. */
  ipHash: string | null;
}

export type Outcome =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string /** The role may not: the action layer journals the attempt. */; denied?: boolean };

const ok = (message: string, id?: string): Outcome =>
  id === undefined ? { ok: true, message } : { ok: true, message, id };
const fail = (message: string): Outcome => ({ ok: false, message });
const DENIED: Outcome = { ok: false, message: guardText("actor_not_allowed"), denied: true };

type Actor = { kind: "owner" | "assistant"; id: string };
const actorOf = (ctx: Ctx): Actor => ({ kind: ctx.user.role === "owner" ? "owner" : "assistant", id: ctx.user.id });

/** Role check, then the work; whatever the services throw becomes text. */
async function guarded(ctx: Ctx, permission: OrdersPermission | null, work: () => Promise<Outcome>): Promise<Outcome> {
  if (permission === null) return fail("Это действие выполняется не отсюда.");
  if (!canDo(ctx.user.role, permission)) return DENIED;
  try {
    return await work();
  } catch (error) {
    return fail(explain(error, permission));
  }
}

/** A line of the journal for a success the services do not journal themselves. */
const journal = (ctx: Ctx, action: string, entity: string, entityId: string | null, after: unknown): Promise<void> =>
  ctx.audit.append({ actor: `admin:${ctx.user.id}`, action, entity, entityId, after, ipHash: ctx.ipHash });

const text = (form: FormInput, name: string): string | undefined => {
  const v = form.get(name)?.trim();
  return v === undefined || v === "" ? undefined : v;
};

const statusText = (status: OrderStatus): string => `Готово. Статус заказа: «${STATUS_LABEL[status] ?? status}».`;

type DispatchAnswer = { ok: true; status: OrderStatus } | { ok: false; error: string };
const fromDispatch = (r: DispatchAnswer): Outcome => (r.ok ? ok(statusText(r.status)) : fail(guardText(r.error)));

// ---- events of the order ------------------------------------------------------------------------------------------
export async function runEvent(ctx: Ctx, orderId: string, type: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, permissionOf(type), async () => {
    if (type === "CANCEL") {
      const reason = text(form, "reason");
      if (!reason) return fail("Укажите причину отмены.");
      const percent = text(form, "assemblyDonePercent");
      const losses = text(form, "documentedLosses");
      const share = percent === undefined ? undefined : parseSum(percent);
      const lost = losses === undefined ? undefined : parseSum(losses);
      if (share === null || (share !== undefined && share > 100))
        return fail("Доля сборки — целое число процентов от 0 до 100.");
      if (lost === null) return fail("Потери с документами — целое число сумов.");
      const r = await ctx.svc.orders.cancel(
        {
          orderId,
          reason,
          ...(share === undefined ? {} : { assemblyDoneBp: share * 100 }),
          ...(lost === undefined ? {} : { documentedLosses: lost }),
        },
        actorOf(ctx),
        ctx.rt,
      );
      return fromDispatch(r);
    }
    const built = buildEvent(type, form, { orderId });
    if (!built.ok) return fail(built.message);
    return fromDispatch(await ctx.svc.orders.dispatch(orderId, built.event, actorOf(ctx), ctx.rt));
  });
}

// ---- the estimate -------------------------------------------------------------------------------------------------
export async function sendQuote(ctx: Ctx, orderId: string, quoteId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "quotes.send", async () => {
    // The check by hand is a decision of the owner (ARCHITECTURE 4.9): the box must be ticked, the service stamps who and when.
    if (form.get("checked") === null)
      return fail("Отметьте «Проверено вручную»: смета уходит клиенту только после проверки.");
    return fromDispatch(await ctx.svc.quotes.send({ orderId, quoteId }, actorOf(ctx), ctx.rt));
  });
}

// ---- payments -----------------------------------------------------------------------------------------------------
/** The kinds whose amount the quote fixes: the amount typed in the form is not taken for them. */
const FIXED_BY_QUOTE = new Set(["fee_advance", "fee_final", "purchase_funds", "podbor_fee"]);

export async function expectPayment(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "payments.write", async () => {
    const kind = text(form, "kind");
    if (!kind) return fail("Выберите вид платежа.");
    const method = text(form, "method");
    const typed = text(form, "amountSum");
    const amount = FIXED_BY_QUOTE.has(kind) || typed === undefined ? undefined : parseSum(typed);
    if (amount === null) return fail("Сумма — целое число сумов.");
    const input = {
      orderId,
      kind: kind as Services.payments.ExpectPaymentInput["kind"],
      ...(amount === undefined ? {} : { amountSum: amount }),
      ...(method === undefined
        ? {}
        : { method: method as NonNullable<Services.payments.ExpectPaymentInput["method"]> }),
    };
    const r = await ctx.svc.payments.expect(input, actorOf(ctx), ctx.rt);
    return ok("Платёж ожидается.", r.paymentId);
  });
}

export async function confirmPayment(ctx: Ctx, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "payments.write", async () => {
    const paymentId = text(form, "paymentId");
    if (!paymentId) return fail("Платёж не выбран.");
    const receipt = text(form, "fiscalReceiptNo");
    const bank = text(form, "bankDocNo");
    const statement = text(form, "statementFileId");
    const other = form.get("payerOther") !== null;
    const r = await ctx.svc.payments.confirm(
      {
        paymentId,
        ...(receipt === undefined ? {} : { fiscalReceiptNo: receipt }),
        ...(bank === undefined ? {} : { bankDocNo: bank }),
        ...(other ? { payerIsCustomer: false } : {}),
        ...(other && statement !== undefined ? { thirdPartyStatementFileId: statement } : {}),
      },
      actorOf(ctx),
      ctx.rt,
    );
    return ok("Платёж подтверждён.", r.paymentId);
  });
}

export async function voidPayment(ctx: Ctx, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "payments.write", async () => {
    const paymentId = text(form, "paymentId");
    const reason = text(form, "reason");
    if (!paymentId) return fail("Платёж не выбран.");
    if (!reason) return fail("Укажите причину: она попадёт в журнал.");
    await ctx.svc.payments.void({ paymentId, reason }, actorOf(ctx), ctx.rt);
    return ok("Платёж аннулирован.", paymentId);
  });
}

export async function reversePayment(ctx: Ctx, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "payments.write", async () => {
    const paymentId = text(form, "paymentId");
    const reason = text(form, "reason");
    if (!paymentId) return fail("Платёж не выбран.");
    if (!reason) return fail("Укажите причину: она попадёт в журнал.");
    const receipt = text(form, "fiscalReceiptNo");
    const bank = text(form, "bankDocNo");
    const typed = text(form, "amountSum");
    const amount = typed === undefined ? undefined : parseSum(typed);
    if (amount === null) return fail("Сумма — целое число сумов.");
    const r = await ctx.svc.payments.reverse(
      {
        paymentId,
        reason,
        ...(amount === undefined ? {} : { amountSum: amount }),
        ...(receipt === undefined ? {} : { fiscalReceiptNo: receipt }),
        ...(bank === undefined ? {} : { bankDocNo: bank }),
      },
      actorOf(ctx),
      ctx.rt,
    );
    return ok("Исправление записано строкой-сторно.", r.reversalId);
  });
}

// ---- purchases ----------------------------------------------------------------------------------------------------
const RECEIPT_KINDS = ["fiscal", "esf", "none_with_consent"] as const;
const ESF_STATUSES = ["pending", "signed", "rejected"] as const;
const PAID_VIA = ["corp_card", "bank_transfer"] as const;
const pick = <T extends string>(allowed: readonly T[], v: string | undefined): T | undefined =>
  allowed.find((a) => a === v);

export async function recordPurchase(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "purchases.write", async () => {
    const vendorId = text(form, "vendorId");
    if (!vendorId) return fail("Выберите магазин.");
    const amount = parseSum(form.get("amountSum"));
    if (amount === null) return fail("Сумма покупки — целое число сумов.");
    const qty = parseSum(form.get("qty"));
    if (qty === null) return fail("Количество — целое число.");
    const paidVia = pick(PAID_VIA, text(form, "paidVia"));
    if (!paidVia) return fail("Выберите, чем оплачено: карта ИП или перевод.");
    const receiptKind = pick(RECEIPT_KINDS, text(form, "receiptKind"));
    if (!receiptKind) return fail("Выберите вид чека.");
    const discountText = text(form, "discountSum");
    const discount = discountText === undefined ? undefined : parseSum(discountText);
    if (discount === null) return fail("Скидка — целое число сумов.");
    const warrantyText = text(form, "vendorWarrantyMonths");
    const warranty = warrantyText === undefined ? undefined : parseSum(warrantyText);
    if (warranty === null) return fail("Гарантия магазина — целое число месяцев.");
    const serials = (form.get("serials") ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const esfStatus = pick(ESF_STATUSES, text(form, "esfStatus"));
    const receiptNo = text(form, "receiptNo");
    const esfNo = text(form, "esfNo");
    const quoteLineId = text(form, "quoteLineId");
    const productId = text(form, "productId");

    const r = await ctx.svc.purchases.record(
      {
        orderId,
        vendorId,
        ...(quoteLineId === undefined ? {} : { quoteLineId }),
        ...(productId === undefined ? {} : { productId }),
        qty,
        amountSum: amount,
        ...(discount === undefined ? {} : { discountSum: discount }),
        paidVia,
        receiptKind,
        ...(receiptNo === undefined ? {} : { receiptNo }),
        ...(esfNo === undefined ? {} : { esfNo }),
        ...(esfStatus === undefined ? {} : { esfStatus }),
        ...(serials.length === 0 ? {} : { serials }),
        ...(warranty === undefined ? {} : { vendorWarrantyMonths: warranty }),
        receiptFileIds: form.getAll("receiptFileIds").filter((v) => v !== ""),
      },
      actorOf(ctx),
      ctx.rt,
    );
    return r.ok ? ok("Покупка записана.", r.purchaseId) : fail(guardText(r.error));
  });
}

const MONEY_CONSENTS = ["limit_overrun", "no_receipt_purchase", "replacement", "third_party_payer"] as const;

const MAX_CONSENT_NOTE = 500;

/**
 * The consent of the customer to what moves money, noted by the owner (the customer said it in the bot or by phone).
 * One press lifts a ban (a purchase over the limit, one without a receipt), so the person says how the customer agreed:
 * that goes into the evidence of the consent with who recorded it, and a line goes into the journal.
 */
export async function recordConsent(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "consents.money", async () => {
    const kind = pick(MONEY_CONSENTS, text(form, "kind"));
    if (!kind) return fail("Выберите вид согласия.");
    const note = text(form, "note");
    if (!note) return fail("Напишите, как и когда клиент согласился: звонок, сообщение в боте, встреча.");
    if (note.length > MAX_CONSENT_NOTE) return fail(`Пояснение длиннее ${MAX_CONSENT_NOTE} знаков.`);
    const customerId = await ctx.facts.customerOf(orderId);
    if (!customerId) return fail("Заказ не найден.");
    const r = await ctx.svc.consents.record(
      {
        kind,
        customerId,
        orderId,
        granted: true,
        channel: "admin",
        evidence: { note, recordedBy: `admin:${ctx.user.id}`, via: "owner_statement" },
      },
      ctx.rt,
    );
    await journal(ctx, "orders.consent_record", "ops.consents", r.id, { kind, orderId, channel: "admin" });
    return ok("Согласие клиента записано.");
  });
}

// ---- the report ---------------------------------------------------------------------------------------------------
export async function generateReport(ctx: Ctx, orderId: string): Promise<Outcome> {
  return guarded(ctx, "reports.write", async () => {
    const r = await ctx.svc.reports.generate({ orderId }, actorOf(ctx), ctx.rt);
    await journal(ctx, "orders.report_generate", "sales.commission_reports", r.reportId, {
      orderId,
      version: r.version,
    });
    return ok(`Отчёт сформирован (версия ${r.version}).`, r.reportId);
  });
}

export async function sendReport(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "reports.write", async () => {
    const reportId = text(form, "reportId");
    if (!reportId) return fail("Сначала сформируйте отчёт.");
    return fromDispatch(await ctx.svc.reports.send({ orderId, reportId }, actorOf(ctx), ctx.rt));
  });
}

export async function resolveObjection(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "reports.write", async () => {
    const note = text(form, "note");
    if (!note) return fail("Напишите ответ клиенту.");
    await ctx.svc.reports.resolveObjection({ orderId, note }, actorOf(ctx), ctx.rt);
    return ok("Ответ на возражение записан: клиент может принять отчёт.");
  });
}

// ---- acts ---------------------------------------------------------------------------------------------------------
const ACT_KINDS = ["material_acceptance", "customer_parts", "handover"] as const;

const MAX_ACT_LINES = 50;
/** The limit of the title in `acts.generate`. */
const MAX_ACT_TITLE = 300;
/** The quantity is looked for in the tail of a line only, so the work does not grow with the length of the line. */
const QTY_TAIL = 24;
/** "× 3" (the sign may stand close), or "x 3" / "х 3" with spaces on both sides: "Kraken X63" and "NF-A12x25" are names. */
const QTY_MARK = /(?:\s*×\s*|\s[xх]\s+)(\d{1,2})$/i;

/**
 * "SSD Samsung 1TB x 2" -> { title, qty }: one line per row; no quantity means one. Null when the list is longer than an
 * act takes (50 lines, 300 characters in a title).
 */
export function parseActLines(raw: string): { title: string; qty: number }[] | null {
  const rows = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (rows.length > MAX_ACT_LINES || rows.some((l) => l.length > MAX_ACT_TITLE)) return null;
  return rows.map((l) => {
    const tail = l.slice(-QTY_TAIL);
    const m = QTY_MARK.exec(tail);
    const title = m ? l.slice(0, l.length - tail.length + m.index).trim() : "";
    return m?.[1] && title !== "" ? { title, qty: Number(m[1]) } : { title: l, qty: 1 };
  });
}

export async function generateAct(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "acts.write", async () => {
    const kind = pick(ACT_KINDS, text(form, "kind"));
    if (!kind) return fail("Выберите вид акта.");
    const lines = parseActLines(form.get("lines") ?? "");
    if (lines === null) {
      return fail(`Список в акте: не больше ${MAX_ACT_LINES} строк, в каждой не больше ${MAX_ACT_TITLE} знаков.`);
    }
    const r = await ctx.svc.acts.generate(
      { orderId, kind, ...(lines.length === 0 ? {} : { lines }) },
      actorOf(ctx),
      ctx.rt,
    );
    return ok("Акт составлен. Распечатайте, подпишите с клиентом и загрузите фото.", r.actId);
  });
}

export async function signPaperAct(ctx: Ctx, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "acts.sign", async () => {
    const actId = text(form, "actId");
    const fileId = text(form, "fileId");
    if (!actId) return fail("Акт не выбран.");
    if (!fileId) return fail("Загрузите фото подписанного бумажного акта.");
    await ctx.svc.acts.sign({ actId, via: "paper_photo", evidence: { fileId } }, actorOf(ctx), ctx.rt);
    return ok("Акт подписан: фото сохранено как подтверждение.", actId);
  });
}

// ---- requests -----------------------------------------------------------------------------------------------------
export async function bindLead(ctx: Ctx, leadId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "leads.work", async () => {
    const customerId = text(form, "customerId");
    if (!customerId) return fail("Выберите клиента.");
    const r = await ctx.svc.leads.bindCustomer({ leadId, customerId }, actorOf(ctx), ctx.rt);
    return ok(r.bound ? "Заявка привязана к клиенту." : "Заявка уже привязана к этому клиенту.");
  });
}

export async function convertLead(ctx: Ctx, leadId: string): Promise<Outcome> {
  return guarded(ctx, "leads.work", async () => {
    const r = await ctx.svc.leads.convert({ leadId }, actorOf(ctx), ctx.rt);
    return ok(r.created ? `Заказ ${r.number} создан.` : `Заказ ${r.number} уже был создан.`, r.orderId);
  });
}

// ---- the PDF documents (WP-12) ------------------------------------------------------------------------------------
export const PDF_DOCS = [
  "quote",
  "commission_report",
  "act_materials",
  "act_customer_parts",
  "act_handover",
  "passport",
  "warranty",
] as const;

/**
 * Queues the rendering of a document; the worker (WP-12) makes the file in uz and ru. Only when the switch is on: the
 * page hides the button, and here it is checked again, because the action can be called without the page. The number of
 * the order and the act come from the database, never from the form or the arguments the page bound (the browser sees
 * them): a job for the worker names a real order and an act of that order.
 */
export async function requestPdf(ctx: Ctx, orderId: string, form: FormInput): Promise<Outcome> {
  return guarded(ctx, "pdf.render", async () => {
    if (!(await ctx.facts.featureOn(PDF_FLAG))) return fail("Документы PDF пока не включены.");
    const doc = pick(PDF_DOCS, text(form, "doc"));
    if (!doc) return fail("Выберите документ.");
    const actId = text(form, "actId");
    if (!UuidSchema.safeParse(orderId).success) return fail("Заказ не найден.");
    if (actId !== undefined && !UuidSchema.safeParse(actId).success) return fail("Акт не найден.");
    const orderNumber = await ctx.facts.orderNumber(orderId);
    if (!orderNumber) return fail("Заказ не найден.");
    if (actId !== undefined && (await ctx.facts.actOrderId(actId)) !== orderId) return fail("Акт не найден.");
    // A second press within the minute is the same job: the queue answers with the one it already has.
    const minute = Math.floor(ctx.now().getTime() / 60_000);
    const queued = await ctx.svc.outbox.enqueue(
      {
        kind: "job",
        payload: { job: "pdf.render", orderId, orderNumber, doc, ...(actId === undefined ? {} : { actId }) },
        dedupeKey: `pdf:${orderId}:${doc}:${actId ?? "-"}:${minute}`,
      },
      {},
      ctx.rt,
    );
    await journal(ctx, "orders.pdf_request", "sales.orders", orderId, {
      doc,
      ...(actId === undefined ? {} : { actId }),
    });
    return ok(
      queued.duplicate
        ? "Документ уже в очереди: файл появится в карточке, когда задача отработает."
        : "Документ поставлен в очередь: файл появится в карточке, когда задача отработает.",
    );
  });
}
