// From the rows of the database to the data of the documents of @nivel/pdf. No money is decided here: the sums are those the services
// and the domain wrote (the columns of the quote, the snapshot of the report, the purchases, the payments); this file picks them, names
// them and hands them over. Two sums are restated from rows that are handed over beside them, by the rule the database itself uses:
// the returns of a report (the sum of its own return rows) and the sum of a line of the estimate (quantity times the price).
// What it decides itself: whether the document is a sample (the offer is a stub, or demo data are in it), when the document is
// ready to be made, where its files lie and where their ids are written.

import { isoDateInTashkent } from "@nivel/domain/calendar";
import type {
  ActDoc,
  ActKind,
  CommissionReportDoc,
  IpRequisites,
  PassportDoc,
  QuoteDoc,
  QuoteLineDoc,
  ReportLineDoc,
  WarrantyDoc,
} from "@nivel/pdf";
import { BuildDataError, NotReadyError } from "./errors.ts";
import type { PdfDoc, PdfRequest } from "./payload.ts";
import type {
  ActRow,
  FeePaymentRow,
  OfferStatus,
  OrderRow,
  PassportRow,
  PdfRows,
  PurchaseRow,
  QuoteLineRow,
  QuoteRow,
  ReportRow,
} from "./rows.ts";

/** ops.settings: the account of the sole proprietor, { holder, inn, bank, account, mfo, purpose }; the bot reads the same key. */
export const REQUISITES_KEY = "requisites.ip";

/**
 * Where the ids of the two files are written. `replace`: the document has stages (an act before and after the signature, a passport
 * before and after the handover) and the link moves on to the file of the later stage; a document with one file keeps its link once
 * written (the quote and the report are versions of their own).
 */
export type LinkTarget =
  | { table: "quotes"; keyColumn: "id"; key: string; replace: false }
  | { table: "commission_reports"; keyColumn: "id"; key: string; replace: false }
  | { table: "acts"; keyColumn: "id"; key: string; replace: true }
  | { table: "build_passports"; keyColumn: "order_id"; key: string; replace: true };

export { BuildDataError, NotReadyError };

export interface Prepared {
  orderNumber: string;
  /**
   * The name of the document inside the folder of the order: "quote-2", "report-1", the whole id of the act and its stage
   * ("act-handover-<id>", "act-handover-<id>-signed"), "passport" and "passport-handed-over". What is made once under a name is kept:
   * a document whose data move on (a signature, a handover) gets a new name when they have.
   */
  base: string;
  fileKind: "quote_pdf" | "report_pdf" | "act_pdf" | "passport_pdf" | "warranty_pdf";
  retention: "tax_5y" | "order_warranty_plus_3y";
  stub: boolean;
  demo: boolean;
  /** Where the ids of the two files are written; the warranty card has no column for them (open request to the integrator). */
  link: LinkTarget | null;
  doc: PdfDoc;
}

/** A document with its data: the kind says which renderer of @nivel/pdf takes them, so the pair cannot come apart. */
export type Built = { prepared: Prepared } & (
  | { kind: "quote"; data: QuoteDoc }
  | { kind: "report"; data: CommissionReportDoc }
  | { kind: "act"; actKind: ActKind; data: ActDoc }
  | { kind: "passport"; data: PassportDoc }
  | { kind: "warranty"; data: WarrantyDoc }
);

export interface BuildContext {
  /** PUBLIC_BASE_URL of the site: the QR code of a passport points at its page. */
  publicBaseUrl: string;
}

// ---- small readers ---------------------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const int = (v: unknown, label: string): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new BuildDataError(`${label} is not a whole number`);
  return v;
};
const isoStamp = (d: Date): string => d.toISOString();
const dayOf = (d: Date): string => isoDateInTashkent(d);

/** The offers of the order are published in both languages; otherwise the documents are samples (R-25, ARCHITECTURE 6.4). */
export function offersAreStub(uz: OfferStatus, ru: OfferStatus): boolean {
  return !(uz === "published" && ru === "published");
}

/** The account of the sole proprietor from the setting; a missing or empty setting is "not registered yet" (null). */
export function parseRequisites(value: unknown): IpRequisites | null {
  if (!isRecord(value)) return null;
  const out: IpRequisites = {
    holder: str(value.holder),
    inn: str(value.inn),
    bank: str(value.bank),
    account: str(value.account),
    mfo: str(value.mfo),
    purpose: str(value.purpose),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** "11772.9500" -> "11 772,95": the rate as a string, no float. */
export function rateText(rate: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) throw new BuildDataError(`the rate ${rate} is not a number`);
  const whole = (m[1] as string).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = (m[2] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${whole},${frac}`;
}

// ---- the estimate ----------------------------------------------------------------------------------------------------------

const FEE_RULES = ["pc_low", "pc_high", "pc_high_min", "mount", "complex"] as const;

/** The rule of a part of the fee as the domain names it (the stored totals are JSON: what is not on the list is damage). */
function feeRule(value: unknown, i: number): QuoteDoc["totals"]["feeParts"][number]["rule"] {
  const rule = FEE_RULES.find((r) => r === value);
  if (rule === undefined)
    throw new BuildDataError(`fee part ${i} has the rule ${String(value)}, the domain has no such`);
  return rule;
}

export function quoteDoc(
  order: OrderRow,
  quote: QuoteRow,
  lines: readonly QuoteLineRow[],
  requisites: IpRequisites | null,
): QuoteDoc {
  const stored = isRecord(quote.totals) && isRecord(quote.totals.totals) ? quote.totals.totals : null;
  const fee = stored && isRecord(stored.fee) ? stored.fee : null;
  if (!stored || !fee || !Array.isArray(fee.parts))
    throw new BuildDataError("the stored totals of the quote have no fee");
  const grandTotal = int(stored.grandTotal, "grandTotal");
  const priceDates = lines.map((l) => l.priceDate).filter((d): d is string => d !== null);
  const docLines: QuoteLineDoc[] = lines.map((l) => ({
    title: l.title,
    qty: l.qty,
    unitSum: l.unitSum,
    group: l.feeGroup,
    priceDate: l.priceDate,
    confidence: l.confidence,
    // The shop of reference is named only when the shop allows it (pricing.vendors.public_name_allowed).
    vendorHint: l.vendorPublicNameAllowed ? l.vendorName : null,
    returnable: l.returnable,
    customerOwned: l.customerOwned,
    purchasedByIp: l.purchasedByIp,
  }));
  return {
    orderNumber: order.number,
    version: quote.version,
    customerName: order.customerName,
    issuedAt: isoStamp(quote.sentAt ?? quote.createdAt),
    priceDate: [...priceDates].sort()[0] ?? null,
    validUntil: quote.validUntil ? isoStamp(quote.validUntil) : null,
    checkedAt: quote.manuallyCheckedAt ? isoStamp(quote.manuallyCheckedAt) : null,
    fx: quote.fx ? { ccy: quote.fx.ccy, rate: rateText(quote.fx.rate), date: quote.fx.date } : null,
    lines: docLines,
    totals: {
      componentsSum: quote.componentsSum,
      outsideScaleSum: quote.outsideScaleSum,
      reserveBp: quote.reserveBp,
      reserveSum: quote.reserveSum,
      purchaseLimit: quote.purchaseLimit,
      feeParts: (fee.parts as unknown[]).map((p, i) => {
        if (!isRecord(p)) throw new BuildDataError(`fee part ${i} is not an object`);
        return {
          group: p.group === "mount" ? ("mount" as const) : ("pc" as const),
          base: int(p.base, `fee part ${i} base`),
          rateBp: int(p.rateBp, `fee part ${i} rate`),
          amount: int(p.amount, `fee part ${i} amount`),
          rule: feeRule(p.rule, i),
        };
      }),
      feeTotal: quote.feeTotal,
      feeCommissionLine: quote.feeCommissionLine,
      feeWorksLine: quote.feeWorksLine,
      advance: quote.feeAdvance,
      final: quote.feeFinal,
      grandTotal,
    },
    requisites,
  };
}

// ---- the report ------------------------------------------------------------------------------------------------------------

interface SnapshotLine {
  purchaseId: string;
  qty: number;
  amountSum: number;
  discountSum: number;
  receiptKind: ReportLineDoc["receiptKind"];
  receiptNo: string | null;
  esfNo: string | null;
  refundOf: string | null;
  boughtAt: string;
}

/** The snapshot of the purchases the report was made from (services/reports: `lines`). */
export function readSnapshot(lines: unknown): SnapshotLine[] {
  if (!Array.isArray(lines)) throw new BuildDataError("the lines of the report are not a list");
  return lines.map((l, i) => {
    if (!isRecord(l) || typeof l.purchaseId !== "string" || typeof l.boughtAt !== "string") {
      throw new BuildDataError(`line ${i} of the report is not a purchase`);
    }
    const kind = l.receiptKind;
    if (kind !== "fiscal" && kind !== "esf" && kind !== "none_with_consent") {
      throw new BuildDataError(`line ${i} of the report has no kind of receipt`);
    }
    return {
      purchaseId: l.purchaseId,
      qty: int(l.qty, `line ${i} qty`),
      amountSum: int(l.amountSum, `line ${i} amount`),
      discountSum: int(l.discountSum ?? 0, `line ${i} discount`),
      receiptKind: kind,
      receiptNo: str(l.receiptNo),
      esfNo: str(l.esfNo),
      refundOf: str(l.refundOf),
      boughtAt: l.boughtAt,
    };
  });
}

export function reportDoc(
  order: OrderRow,
  report: ReportRow,
  purchases: readonly PurchaseRow[],
  payments: readonly FeePaymentRow[],
  quote: QuoteRow | null,
  requisites: IpRequisites | null,
): CommissionReportDoc {
  const byId = new Map(purchases.map((p) => [p.id, p]));
  const objectionUntil = report.objectionUntil ?? order.objectionUntil;
  const lines: ReportLineDoc[] = readSnapshot(report.lines).map((s) => {
    const p = byId.get(s.purchaseId);
    return {
      title: p?.title ?? "—",
      qty: s.qty,
      serials: p?.serials ?? [],
      vendor: p?.vendorName ?? null,
      // The tax number of the shop and the VAT in the price are parts of the table of the report (PKM 489, item 28), but the database
      // holds neither (pricing.vendors has no INN, a purchase has no VAT): the fields stay empty until the integrator adds the
      // columns (request in the report of WP-12); the template prints them as soon as they are filled.
      vendorInn: null,
      boughtAt: s.boughtAt,
      receiptKind: s.receiptKind,
      receiptNo: s.receiptNo,
      esfNo: s.esfNo,
      amountSum: s.amountSum,
      vatSum: null,
      discountSum: s.discountSum,
      bonusNote: p?.bonusNote ?? null,
      vendorWarrantyMonths: p?.vendorWarrantyMonths ?? null,
      vendorWarrantyUntil: p?.vendorWarrantyUntil ?? null,
      isReturn: s.refundOf !== null,
      files: p?.files ?? 0,
    };
  });
  return {
    orderNumber: order.number,
    reportVersion: report.version,
    quoteVersion: quote?.version ?? null,
    customerName: order.customerName,
    issuedAt: isoStamp(report.generatedAt),
    sentAt: report.sentAt ? isoStamp(report.sentAt) : null,
    acceptedAt: report.acceptedAt ? isoStamp(report.acceptedAt) : null,
    deemedAcceptedAt: report.deemedAcceptedAt ? isoStamp(report.deemedAcceptedAt) : null,
    objectionUntil: objectionUntil ? isoStamp(objectionUntil) : null,
    refundDueAt: order.refundDueAt ? isoStamp(order.refundDueAt) : null,
    ip: requisites,
    receivedSum: report.receivedSum,
    spentSum: report.spentSum,
    discountsSum: report.discountsSum,
    remainderSum: report.remainderSum,
    // restated from the rows of the report itself (the report keeps no such sum): the returns, positive
    refundsSum: lines.filter((l) => l.isReturn).reduce((n, l) => n - l.amountSum, 0),
    purchaseLimit: quote?.purchaseLimit ?? null,
    lines,
    fee: quote
      ? { commissionLine: quote.feeCommissionLine, worksLine: quote.feeWorksLine, total: quote.feeTotal }
      : null,
    feePayments: payments.map((p) => ({
      kind: p.kind,
      sum: p.sum,
      receiptNo: p.receiptNo,
      at: p.confirmedAt ? isoStamp(p.confirmedAt) : null,
    })),
  };
}

// ---- the acts --------------------------------------------------------------------------------------------------------------

const ACT_OF_DOC = {
  act_materials: "material_acceptance",
  act_customer_parts: "customer_parts",
  act_handover: "handover",
} as const;

/** The act of acceptance has the purchases the customer paid for (net of the returns) and their sum as the database holds it. */
export function actDoc(
  order: OrderRow,
  act: ActRow,
  purchases: readonly PurchaseRow[],
  receiptsTotal: number,
  requisites: IpRequisites | null,
): ActDoc {
  if (!Array.isArray(act.lines)) throw new BuildDataError("the lines of the act are not a list");
  const lines = (act.lines as unknown[]).map((l, i) => {
    if (!isRecord(l) || typeof l.title !== "string") throw new BuildDataError(`line ${i} of the act has no title`);
    return { title: l.title, qty: int(l.qty, `line ${i} qty`), serial: str(l.serial) };
  });
  return {
    orderNumber: order.number,
    customerName: order.customerName,
    issuedAt: isoStamp(act.createdAt),
    lines,
    ...(act.kind === "material_acceptance"
      ? {
          receipts: purchases.map((p) => ({
            title: p.title ?? "—",
            qty: p.qty,
            amountSum: p.netSum,
            receiptNo: p.receiptNo ?? p.esfNo,
            boughtAt: isoStamp(p.boughtAt),
          })),
          receiptsTotal,
        }
      : {}),
    signed: act.signedAt && act.signedVia ? { at: isoStamp(act.signedAt), via: act.signedVia } : null,
    warrantyUntil: order.warrantyUntil ? dayOf(order.warrantyUntil) : null,
    ip: requisites,
  };
}

// ---- the passport and the warranty card ------------------------------------------------------------------------------------

export function passportDoc(
  order: OrderRow,
  passport: PassportRow,
  dates: { estimateAt: Date | null; testsAt: Date | null; actAt: Date | null },
  ctx: BuildContext,
  issuedAt: Date,
): PassportDoc {
  const serials = isRecord(passport.serials)
    ? Object.entries(passport.serials).flatMap(([label, value]) =>
        typeof value === "string" && value.trim() !== "" ? [{ label, value: value.trim() }] : [],
      )
    : [];
  const t = isRecord(passport.tests) ? passport.tests : null;
  const errors =
    t && Array.isArray(t.errors) ? (t.errors as unknown[]).filter((e): e is string => typeof e === "string") : [];
  return {
    orderNumber: order.number,
    customerName: order.customerName,
    issuedAt: isoStamp(issuedAt),
    dates: {
      estimateAt: dates.estimateAt ? isoStamp(dates.estimateAt) : null,
      testsAt: dates.testsAt ? isoStamp(dates.testsAt) : null,
      actAt: dates.actAt ? isoStamp(dates.actAt) : null,
      warrantyUntil: order.warrantyUntil ? dayOf(order.warrantyUntil) : null,
    },
    serials,
    biosVersion: passport.biosVersion,
    os: passport.os,
    tests: t
      ? {
          tool: str(t.tool),
          scenario: str(t.scenario),
          minutes: typeof t.minutes === "number" && Number.isSafeInteger(t.minutes) ? t.minutes : null,
          peakTempC: typeof t.peakTempC === "number" && Number.isSafeInteger(t.peakTempC) ? t.peakTempC : null,
          errors,
        }
      : null,
    photos: Array.isArray(passport.photos) ? passport.photos.length : 0,
    sealPhotos: Array.isArray(passport.sealPhotos) ? passport.sealPhotos.length : 0,
    labelCode: passport.labelCode,
    notes: passport.notes,
    qr: passport.labelCode
      ? `${ctx.publicBaseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(passport.labelCode)}`
      : null,
  };
}

export function warrantyDoc(
  order: OrderRow,
  purchases: readonly PurchaseRow[],
  requisites: IpRequisites | null,
  issuedAt: Date,
): WarrantyDoc {
  return {
    orderNumber: order.number,
    customerName: order.customerName,
    issuedAt: isoStamp(issuedAt),
    handedOverAt: order.handedOverAt ? isoStamp(order.handedOverAt) : null,
    warrantyUntil: order.warrantyUntil ? dayOf(order.warrantyUntil) : null,
    items: purchases.map((p) => ({
      title: p.title ?? "—",
      serial: p.serials.length > 0 ? p.serials.join(", ") : null,
      vendorWarrantyUntil: p.vendorWarrantyUntil,
    })),
    ip: requisites,
  };
}

// ---- the choice ------------------------------------------------------------------------------------------------------------

/**
 * Loads what the document needs and decides how it is named, kept and linked. Throws `NotReadyError` for a document the order has
 * not got yet (the job tries again), `BuildDataError` for data no second try can mend.
 */
export async function build(req: PdfRequest, rows: PdfRows, ctx: BuildContext, now: Date): Promise<Built> {
  const order = await rows.order(req.orderId);
  if (!order) throw new NotReadyError(`the order ${req.orderId} does not exist`);
  const stub = offersAreStub(
    await rows.offerStatus("uz", order.offerUzId),
    await rows.offerStatus("ru", order.offerRuId),
  );
  const requisites = parseRequisites(await rows.setting(REQUISITES_KEY));
  const base = { orderNumber: order.number, stub, doc: req.doc };

  switch (req.doc) {
    case "quote": {
      // The estimate that went out, never a draft: the paper is what the customer was sent, with the sums he accepts. A draft that
      // the owner is still mending is not rendered under the name of the version it will become.
      const quoteId = await rows.sentQuoteId(order.id);
      if (!quoteId) throw new NotReadyError(`the order ${order.number} has no sent quote`);
      const q = await rows.quote(quoteId);
      if (!q) throw new NotReadyError(`the quote of the order ${order.number} does not exist`);
      return {
        kind: "quote",
        prepared: {
          ...base,
          base: `quote-${q.row.version}`,
          fileKind: "quote_pdf",
          retention: "tax_5y",
          demo: q.lines.some((l) => l.demo),
          link: { table: "quotes", keyColumn: "id", key: q.row.id, replace: false },
        },
        data: quoteDoc(order, q.row, q.lines, requisites),
      };
    }
    case "commission_report": {
      const report = await rows.report(order.id);
      if (!report) throw new NotReadyError(`the order ${order.number} has no report`);
      const snapshot = readSnapshot(report.lines);
      const purchases = await rows.purchasesByIds(
        snapshot.map((s) => s.purchaseId),
        order.id,
      );
      const quote = order.currentQuoteId ? ((await rows.quote(order.currentQuoteId))?.row ?? null) : null;
      return {
        kind: "report",
        prepared: {
          ...base,
          base: `report-${report.version}`,
          fileKind: "report_pdf",
          retention: "tax_5y",
          demo: purchases.some((p) => p.demo),
          link: { table: "commission_reports", keyColumn: "id", key: report.id, replace: false },
        },
        data: reportDoc(order, report, purchases, await rows.feePayments(order.id), quote, requisites),
      };
    }
    case "act_materials":
    case "act_customer_parts":
    case "act_handover": {
      const kind = ACT_OF_DOC[req.doc];
      const act = await rows.act(order.id, req.actId, kind);
      if (!act) throw new NotReadyError(`the order ${order.number} has no act ${kind}`);
      if (act.kind !== kind) throw new BuildDataError(`the act ${act.id} is ${act.kind}, not ${kind}`);
      const kept = await rows.purchasesOfOrder(order.id);
      const signed = act.signedAt !== null && act.signedVia !== null;
      return {
        kind: "act",
        actKind: kind,
        prepared: {
          ...base,
          // the whole id: the first characters of a time-ordered id are the same for acts made within a minute of each other
          base: `act-${kind.replace("_", "-")}-${act.id}${signed ? "-signed" : ""}`,
          fileKind: "act_pdf",
          retention: "tax_5y",
          demo: kept.some((p) => p.demo),
          link: { table: "acts", keyColumn: "id", key: act.id, replace: true },
        },
        data: actDoc(
          order,
          act,
          kind === "material_acceptance" ? kept : [],
          kind === "material_acceptance" ? await rows.receiptsTotal(order.id) : 0,
          requisites,
        ),
      };
    }
    case "passport": {
      const passport = await rows.passport(order.id);
      if (!passport) throw new NotReadyError(`the order ${order.number} has no passport of the build`);
      const dates = {
        estimateAt: await rows.estimateSentAt(order.id),
        testsAt: await rows.testsPassedAt(order.id),
        actAt: await rows.handoverSignedAt(order.id),
      };
      // The passport is made when the tests are passed and not before: the row of the master exists from the first photo, and a
      // paper without the protocol of the tests must not take the name of the passport.
      if (dates.testsAt === null) throw new NotReadyError(`the tests of the order ${order.number} are not passed yet`);
      const handedOver = order.warrantyUntil !== null && dates.actAt !== null;
      return {
        kind: "passport",
        prepared: {
          ...base,
          base: handedOver ? "passport-handed-over" : "passport",
          fileKind: "passport_pdf",
          retention: "order_warranty_plus_3y",
          demo: (await rows.purchasesOfOrder(order.id)).some((p) => p.demo),
          link: { table: "build_passports", keyColumn: "order_id", key: order.id, replace: true },
        },
        data: passportDoc(order, passport, dates, ctx, now),
      };
    }
    case "warranty": {
      const purchases = await rows.purchasesOfOrder(order.id);
      const handedOver = order.warrantyUntil !== null && order.handedOverAt !== null;
      return {
        kind: "warranty",
        prepared: {
          ...base,
          base: handedOver ? "warranty-handed-over" : "warranty",
          fileKind: "warranty_pdf",
          retention: "order_warranty_plus_3y",
          demo: purchases.some((p) => p.demo),
          link: null,
        },
        data: warrantyDoc(order, purchases, requisites, now),
      };
    }
  }
}
