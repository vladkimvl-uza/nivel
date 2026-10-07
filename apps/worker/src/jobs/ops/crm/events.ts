// The events of the platform for the CRM of the owner in Google Sheets (tools/crm-sheets/README.md, "Вебхук: контракт"). The worker sends
// five kinds of events to the web app of the script: lead.created, order.status_changed, payment.confirmed, purchase.recorded,
// warranty.case_opened. This file only builds them from facts that were read from the database and signs the request; it
// reaches nobody. Sums are whole sums, dates are ISO 8601 with +05:00, codes are the codes of the domain. Personal data goes only as
// far as the owner allowed: the name and the Telegram nick of the customer, never the phone or the address.
import { createHmac } from "node:crypto";

import { maskPersonalData } from "../../../queues/failures.ts";

export const CRM_VERSION = 1;
export const CRM_SOURCE = "nivel-platform";
export const CRM_EVENT_TYPES = [
  "lead.created",
  "order.status_changed",
  "payment.confirmed",
  "purchase.recorded",
  "warranty.case_opened",
] as const;
export type CrmEventType = (typeof CRM_EVENT_TYPES)[number];

const TASHKENT_MS = 5 * 3_600_000;

/** 2026-10-06T14:05:00+05:00: the time of Tashkent with the offset, to the second. */
export function iso(at: Date): string {
  return `${new Date(at.getTime() + TASHKENT_MS).toISOString().slice(0, 19)}+05:00`;
}

const cut = (v: string | null | undefined, max: number): string | null =>
  v === null || v === undefined || v === "" ? null : v.slice(0, max);

/**
 * A text a person wrote (a comment, a reason, a title, a name): a phone number, a card number or an e-mail address in it does not
 * leave the platform, the CRM gets the mark instead (the header of this file: never the phone or the address).
 */
const free = (v: string | null | undefined, max: number): string | null => {
  const masked = v === null || v === undefined ? v : maskPersonalData(v);
  return cut(masked, max);
};

// ---- the codes of the platform that the CRM names differently -----------------------------------------------------------

/** The channel of a request as the CRM calls it (the CRM knows `bot` and `site`, not `web`, `tma`, `ai`). */
export function crmChannel(channel: string): string {
  const map: Record<string, string> = { web: "site", bot: "bot", tma: "bot", admin: "other", ai: "site" };
  return map[channel] ?? "other";
}

// ---- lead.created -------------------------------------------------------------------------------------------------------

export interface LeadFacts {
  number: string;
  createdAt: Date;
  channel: string;
  utm: Record<string, string> | null;
  lang: "uz" | "ru";
  district: string | null;
  scope: string;
  /** YYYY-MM-DD */
  wantedBy: string | null;
  configurationCode: string | null;
  customer: { ref: string; displayName: string | null; telegramUsername: string | null } | null;
}

export function leadCreatedData(f: LeadFacts): Record<string, unknown> {
  const utm = f.utm ?? {};
  return {
    number: f.number,
    created_at: iso(f.createdAt),
    channel: crmChannel(f.channel),
    source_code: cut(utm.source, 60),
    utm: {
      source: utm.utm_source ?? utm.source ?? null,
      medium: utm.utm_medium ?? utm.medium ?? null,
      campaign: utm.utm_campaign ?? utm.campaign ?? null,
    },
    lang: f.lang,
    district: cut(f.district, 60),
    scope: f.scope,
    // The bands of the platform (lt_6_7m ... gte_35m) are not the bands of the CRM (lt5 ... gt60): none is sent (see the report).
    budget_band: null,
    wanted_by: f.wantedBy,
    configuration_code: cut(f.configurationCode, 16),
    customer:
      f.customer === null
        ? null
        : {
            ref: f.customer.ref,
            display_name: free(f.customer.displayName, 100),
            telegram_username: cut(f.customer.telegramUsername, 64),
          },
    tg_topic_url: null,
    admin_url: null,
  };
}

// ---- order.status_changed -----------------------------------------------------------------------------------------------

export interface QuoteFacts {
  id: string;
  version: number;
  componentsSum: number;
  outsideScaleSum: number;
  purchaseLimit: number;
  reserveBp: number;
  reserveSum: number;
  feeTotal: number;
  feeCommissionLine: number;
  feeWorksLine: number;
  feeAdvance: number;
  feeFinal: number;
  eligibility: string | null;
  validUntil: Date | null;
  /** The base of the fee of the groups: the PC and the mounting (optional, the CRM falls back to "all PC"). */
  pcBase?: number;
  mountBase?: number;
}

export interface OrderChangeFacts {
  number: string;
  leadNumber: string | null;
  customerRef: string | null;
  kind: string;
  seq: number;
  from: string | null;
  to: string;
  event: string;
  actor: string;
  at: Date;
  flags: { feePrepaid: boolean; fundsReceived: boolean; firstOrderMeetingDone: boolean };
  quote: QuoteFacts | null;
  dates: {
    purchaseNotBefore: Date | null;
    reportDueAt: Date | null;
    objectionUntil: Date | null;
    refundDueAt: Date | null;
    warrantyUntil: Date | null;
    podborCreditUntil: Date | null;
  };
  report: { accepted: boolean; objectionOpen: boolean } | null;
  cancel: {
    point: string;
    reason: string;
    settlement: {
      feeEarned: number;
      feeToRefund: number;
      feeToInvoice: number;
      fundsToRefund: number;
      partsGoTo: string;
      dueBy: Date | null;
    };
  } | null;
  ledger: { fund: "warranty" | "tax_risk"; amount: number }[];
}

const dateOrNull = (d: Date | null): string | null => (d === null ? null : iso(d));

export function orderStatusChangedData(f: OrderChangeFacts): Record<string, unknown> {
  const q = f.quote;
  return {
    number: f.number,
    lead_number: f.leadNumber,
    customer_ref: f.customerRef,
    kind: f.kind,
    seq: f.seq,
    from: f.from,
    to: f.to,
    event: f.event,
    actor: f.actor,
    at: iso(f.at),
    flags: {
      fee_prepaid: f.flags.feePrepaid,
      funds_received: f.flags.fundsReceived,
      first_order_meeting_done: f.flags.firstOrderMeetingDone,
    },
    quote:
      q === null
        ? null
        : {
            id: q.id,
            version: q.version,
            components_sum: q.componentsSum,
            outside_scale_sum: q.outsideScaleSum,
            purchase_limit: q.purchaseLimit,
            reserve_bp: q.reserveBp,
            reserve_sum: q.reserveSum,
            fee_total: q.feeTotal,
            fee_commission_line: q.feeCommissionLine,
            fee_works_line: q.feeWorksLine,
            fee_advance: q.feeAdvance,
            fee_final: q.feeFinal,
            grand_total: q.purchaseLimit + q.feeTotal,
            eligibility: q.eligibility,
            valid_until: dateOrNull(q.validUntil),
            ...(q.pcBase === undefined ? {} : { pc_base: q.pcBase }),
            ...(q.mountBase === undefined ? {} : { mount_base: q.mountBase }),
          },
    dates: {
      purchase_not_before: dateOrNull(f.dates.purchaseNotBefore),
      report_due_at: dateOrNull(f.dates.reportDueAt),
      objection_until: dateOrNull(f.dates.objectionUntil),
      refund_due_at: dateOrNull(f.dates.refundDueAt),
      warranty_until: dateOrNull(f.dates.warrantyUntil),
      podbor_credit_until: dateOrNull(f.dates.podborCreditUntil),
    },
    report: f.report === null ? null : { accepted: f.report.accepted, objection_open: f.report.objectionOpen },
    cancel:
      f.cancel === null
        ? null
        : {
            point: f.cancel.point,
            reason: free(f.cancel.reason, 500) ?? "",
            settlement: {
              fee_earned: f.cancel.settlement.feeEarned,
              fee_to_refund: f.cancel.settlement.feeToRefund,
              fee_to_invoice: f.cancel.settlement.feeToInvoice,
              funds_to_refund: f.cancel.settlement.fundsToRefund,
              parts_go_to: f.cancel.settlement.partsGoTo,
              due_by: dateOrNull(f.cancel.settlement.dueBy),
            },
          },
    ledger: f.ledger.map((l) => ({ fund: l.fund, amount: l.amount })),
  };
}

// ---- payment.confirmed --------------------------------------------------------------------------------------------------

export interface PaymentFacts {
  paymentId: string;
  orderNumber: string;
  kind: string;
  direction: "in" | "out";
  method: string;
  /** A positive sum: a reversal is sent as the void of the payment it reverses. */
  amountSum: number;
  status: "confirmed" | "void";
  fiscalReceiptNo: string | null;
  bankDocNo: string | null;
  occurredAt: Date;
  confirmedAt: Date | null;
  payerIsCustomer: boolean;
  reversalOf: string | null;
}

export function paymentConfirmedData(f: PaymentFacts): Record<string, unknown> {
  return {
    payment_id: f.paymentId,
    order_number: f.orderNumber,
    kind: f.kind,
    direction: f.direction,
    method: f.method,
    amount_sum: f.amountSum,
    status: f.status,
    fiscal_receipt_no: cut(f.fiscalReceiptNo, 64),
    bank_doc_no: cut(f.bankDocNo, 64),
    occurred_at: iso(f.occurredAt),
    confirmed_at: f.confirmedAt === null ? null : iso(f.confirmedAt),
    payer_is_customer: f.payerIsCustomer,
    reversal_of: f.reversalOf,
  };
}

// ---- purchase.recorded --------------------------------------------------------------------------------------------------

export interface PurchaseFacts {
  purchaseId: string;
  orderNumber: string;
  title: string;
  categoryCode: string | null;
  vendorName: string;
  qty: number;
  amountSum: number;
  paidVia: string;
  receiptKind: string;
  receiptNo: string | null;
  esfNo: string | null;
  /** YYYY-MM-DD */
  esfDue: string | null;
  discountSum: number;
  bonusNote: string | null;
  serials: string[];
  vendorWarrantyMonths: number | null;
  /** YYYY-MM-DD */
  vendorWarrantyUntil: string | null;
  boughtAt: Date;
  totals: { receiptsTotal: number; fundsReceived: number; purchaseLimit: number };
}

export function purchaseRecordedData(f: PurchaseFacts): Record<string, unknown> {
  return {
    purchase_id: f.purchaseId,
    order_number: f.orderNumber,
    title: free(f.title, 200) ?? "",
    category_code: f.categoryCode,
    vendor_name: free(f.vendorName, 100) ?? "",
    qty: f.qty,
    amount_sum: f.amountSum,
    paid_via: f.paidVia,
    receipt_kind: f.receiptKind,
    receipt_no: cut(f.receiptNo, 64),
    esf_no: cut(f.esfNo, 64),
    esf_due: f.esfDue,
    discount_sum: f.discountSum,
    bonus_note: free(f.bonusNote, 200),
    serials: f.serials,
    vendor_warranty_months: f.vendorWarrantyMonths,
    vendor_warranty_until: f.vendorWarrantyUntil,
    bought_at: iso(f.boughtAt),
    totals: {
      receipts_total: f.totals.receiptsTotal,
      funds_received: f.totals.fundsReceived,
      purchase_limit: f.totals.purchaseLimit,
    },
  };
}

// ---- warranty.case_opened -----------------------------------------------------------------------------------------------

export interface WarrantyFacts {
  number: string;
  orderNumber: string;
  purchaseId: string | null;
  openedAt: Date;
  channel: string | null;
  summary: string;
  status: string;
  dueReply: Date | null;
  dueDiagnosis: Date | null;
  dueLoaner: Date | null;
  dueFix: Date | null;
}

export function warrantyCaseOpenedData(f: WarrantyFacts): Record<string, unknown> {
  return {
    number: f.number,
    order_number: f.orderNumber,
    purchase_id: f.purchaseId,
    opened_at: iso(f.openedAt),
    channel: f.channel,
    summary: free(f.summary, 500) ?? "",
    status: f.status,
    deadlines: {
      reply: dateOrNull(f.dueReply),
      diagnosis: dateOrNull(f.dueDiagnosis),
      loaner: dateOrNull(f.dueLoaner),
      // The platform keeps one term of the fix; the CRM takes it as the term of the work and counts the parts itself.
      fix_work: dateOrNull(f.dueFix),
    },
  };
}

// ---- the envelope and the signature -------------------------------------------------------------------------------------

export interface Envelope {
  v: 1;
  id: string;
  type: CrmEventType;
  env: string;
  source: typeof CRM_SOURCE;
  occurred_at: string;
  sent_at: string;
  data: Record<string, unknown>;
}

/** The envelope of an event. `id` is the id of the row of the outbox, so a repeat of the same event has the same id. */
export function envelope(o: {
  id: string;
  type: CrmEventType;
  env: string;
  occurredAt: Date;
  sentAt: Date;
  data: Record<string, unknown>;
}): Envelope {
  return {
    v: CRM_VERSION,
    id: o.id,
    type: o.type,
    env: o.env,
    source: CRM_SOURCE,
    occurred_at: iso(o.occurredAt),
    sent_at: iso(o.sentAt),
    data: o.data,
  };
}

/** sig = hex(HMAC-SHA256(secret, ts + "." + raw body)), ts in unix seconds, the body in UTF-8. */
export function signCrm(secret: string, ts: number | string, body: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
}

/** The signed request: the address with the version, the stamp and the signature, and the raw body that was signed. */
export function signedRequest(
  baseUrl: string,
  secret: string,
  env: Envelope,
  now: Date,
): { url: string; body: string; ts: number } {
  const body = JSON.stringify(env);
  const ts = Math.floor(now.getTime() / 1000);
  const url = new URL(baseUrl);
  url.searchParams.set("v", String(CRM_VERSION));
  url.searchParams.set("ts", String(ts));
  url.searchParams.set("sig", signCrm(secret, ts, body));
  return { url: url.toString(), body, ts };
}
