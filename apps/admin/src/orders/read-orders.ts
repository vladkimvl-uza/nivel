// What the board and the card of an order show, read from the database of the admin role. Reading only: every sum here
// is a stored one (the quote, the payments, the purchases); nothing is calculated in the screens (red lines).
import type { Db } from "@nivel/db";
import { sales } from "@nivel/db/repos";
import type { OrderStatus } from "@nivel/domain/order";

const num = (v: unknown): number => Number(v ?? 0);

// ---- the board ----------------------------------------------------------------------------------------------------
export interface BoardRow {
  id: string;
  number: string;
  kind: string;
  status: OrderStatus;
  customerName: string;
  customerUsername: string | null;
  createdAt: Date;
  updatedAt: Date;
  purchaseLimit: number | null;
  feeTotal: number | null;
  leadNumber: string | null;
}

export interface BoardQuery {
  /** A part of the number, the name or the Telegram name of the customer. */
  q?: string;
  status?: OrderStatus;
  limit?: number;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listBoard(db: Db, query: BoardQuery = {}): Promise<BoardRow[]> {
  const q = query.q?.trim() ? `%${escapeLike(query.q.trim())}%` : null;
  const { rows } = await db.$client.query<{
    id: string;
    number: string;
    kind: string;
    status: OrderStatus;
    display_name: string | null;
    telegram_username: string | null;
    created_at: Date;
    updated_at: Date;
    purchase_limit: string | null;
    fee_total: string | null;
    lead_number: string | null;
  }>(
    `select o.id, o.number, o.kind, o.status, c.display_name, c.telegram_username, o.created_at, o.updated_at,
            q.purchase_limit::text as purchase_limit, q.fee_total::text as fee_total, l.number as lead_number
       from sales.orders o
       join sales.customers c on c.id = o.customer_id
       left join sales.quotes q on q.id = o.current_quote_id
       left join sales.leads l on l.id = o.lead_id
      where ($1::text is null or o.number ilike $1 escape '\\' or c.display_name ilike $1 escape '\\'
             or c.telegram_username ilike $1 escape '\\')
        and ($2::text is null or o.status = $2)
      order by o.updated_at desc, o.id desc
      limit $3`,
    [q, query.status ?? null, query.limit ?? 300],
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    status: r.status,
    customerName: r.display_name ?? "Без имени",
    customerUsername: r.telegram_username,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    purchaseLimit: r.purchase_limit === null ? null : num(r.purchase_limit),
    feeTotal: r.fee_total === null ? null : num(r.fee_total),
    leadNumber: r.lead_number,
  }));
}

// ---- the card -----------------------------------------------------------------------------------------------------
type OrderRow = NonNullable<Awaited<ReturnType<typeof sales.getOrder>>>;
type PaymentRow = Awaited<ReturnType<typeof sales.listPayments>>[number];
type PurchaseRow = Awaited<ReturnType<typeof sales.listPurchases>>[number];
type EventRow = Awaited<ReturnType<typeof sales.listOrderEvents>>[number];

export interface CardCustomer {
  id: string;
  displayName: string;
  telegramUsername: string | null;
  /** Only for the roles that may read phones (the owner). */
  phone: string | null;
  district: string | null;
  lang: "uz" | "ru";
  erased: boolean;
}

export interface QuoteTotalsView {
  componentsSum: number;
  outsideScaleSum: number;
  reserveBp: number;
  reserveSum: number;
  purchaseLimit: number;
  feeTotal: number;
  feeCommissionLine: number;
  feeWorksLine: number;
  advance: number;
  final: number;
  grandTotal: number;
  effectiveRateBp: number | null;
  eligibility: string;
  minEstimate: number | null;
  warnings: { key: string; params?: Record<string, string | number> }[];
}

export interface QuoteLineView {
  id: string;
  productId: string | null;
  title: string;
  categoryCode: string;
  feeGroup: string;
  qty: number;
  unitSum: number;
  priceDate: string | null;
  confidence: string | null;
  returnable: string;
  customerOwned: boolean;
  purchasedByIp: boolean;
}

/** The files of a document made by the worker (WP-12), by language; empty until it has run. */
export interface PdfFiles {
  uz: string | null;
  ru: string | null;
}

export interface QuoteView {
  id: string;
  version: number;
  status: string;
  validUntil: Date | null;
  sentAt: Date | null;
  manuallyCheckedAt: Date | null;
  watermarkDraft: boolean;
  settingsVersion: string;
  totals: QuoteTotalsView;
  compatVerdict: string;
  shelfLifeHours: number | null;
  lines: QuoteLineView[];
  pdf: PdfFiles;
}

export interface PaymentView {
  id: string;
  kind: string;
  direction: "in" | "out";
  method: string;
  amountSum: number;
  status: string;
  fiscalReceiptNo: string | null;
  bankDocNo: string | null;
  payerIsCustomer: boolean;
  thirdPartyStatementFileId: string | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  reversalOf: string | null;
  createdAt: Date;
}

export interface PurchaseView {
  id: string;
  vendorName: string;
  quoteLineId: string | null;
  qty: number;
  amountSum: number;
  discountSum: number;
  refundOf: string | null;
  paidVia: string;
  receiptKind: string;
  receiptNo: string | null;
  esfNo: string | null;
  esfStatus: string | null;
  esfDue: string | null;
  serials: string[];
  vendorWarrantyUntil: string | null;
  boughtAt: Date;
  boughtBy: string;
  files: { id: string; kind: string }[];
}

export interface ReportView {
  id: string;
  version: number;
  receivedSum: number;
  spentSum: number;
  discountsSum: number;
  remainderSum: number;
  generatedAt: Date;
  sentAt: Date | null;
  dueAt: Date | null;
  objectionUntil: Date | null;
  objection: { text?: string; note?: string; resolved: boolean } | null;
  acceptedAt: Date | null;
  deemedAcceptedAt: Date | null;
  pdf: PdfFiles;
}

export interface ActView {
  id: string;
  kind: string;
  lines: { title: string; qty: number }[];
  signedAt: Date | null;
  signedVia: string | null;
  evidenceFileId: string | null;
  createdAt: Date;
  pdf: PdfFiles;
}

export interface PassportView {
  serials: Record<string, string>;
  biosVersion: string | null;
  os: string | null;
  tests: { tool?: string; scenario?: string; minutes?: number; peakTempC?: number; errors?: string[] } | null;
  photoIds: string[];
  sealPhotoIds: string[];
  labelCode: string | null;
  notes: string | null;
  pdf: PdfFiles;
}

export interface WarrantyCaseView {
  id: string;
  number: string;
  status: string;
  description: string;
  openedAt: Date;
  dueReply: Date | null;
  dueDiagnosis: Date | null;
  dueFix: Date | null;
  clientFault: string | null;
  closedAt: Date | null;
}

export interface MoneyView {
  fundsReceived: number;
  receiptsTotal: number;
  refunded: number;
  documentedLosses: number;
  hasLimitOverrunConsent: boolean;
}

export interface OrderCard {
  order: OrderRow;
  customer: CardCustomer;
  leadNumber: string | null;
  offer: { uz: string; ru: string };
  quote: QuoteView | null;
  quoteVersions: { id: string; version: number; status: string; createdAt: Date }[];
  events: EventRow[];
  payments: PaymentView[];
  purchases: PurchaseView[];
  money: MoneyView;
  reports: ReportView[];
  acts: ActView[];
  passport: PassportView | null;
  warranty: WarrantyCaseView[];
  consents: { kind: string; granted: boolean; at: Date }[];
  /** Registered files named by the order (receipts, statements, act photos), by id: for the links. */
  files: Record<string, { kind: string; mime: string; bytes: number }>;
}

type QuoteRow = NonNullable<Awaited<ReturnType<typeof sales.getQuote>>>;

/** The sums are the columns of the quote, as the database holds them (all of them are NOT NULL); the rest is the stored calculation. */
function parseTotals(raw: unknown, row: QuoteRow): QuoteTotalsView {
  const stored = (raw as { totals?: Record<string, unknown> } | null)?.totals ?? {};
  const fee = (stored.fee ?? {}) as Record<string, unknown>;
  const elig = (stored.eligibility ?? {}) as { mode?: string; minEstimate?: number };
  return {
    componentsSum: row.componentsSum,
    outsideScaleSum: row.outsideScaleSum,
    reserveBp: row.reserveBp,
    reserveSum: row.reserveSum,
    purchaseLimit: row.purchaseLimit,
    feeTotal: row.feeTotal,
    feeCommissionLine: row.feeCommissionLine,
    feeWorksLine: row.feeWorksLine,
    advance: row.feeAdvance,
    final: row.feeFinal,
    grandTotal: num(stored.grandTotal),
    effectiveRateBp: typeof fee.effectiveRateBp === "number" ? fee.effectiveRateBp : null,
    eligibility: elig.mode ?? "unknown",
    minEstimate: typeof elig.minEstimate === "number" ? elig.minEstimate : null,
    warnings: Array.isArray(stored.warnings) ? (stored.warnings as QuoteTotalsView["warnings"]) : [],
  };
}

async function loadQuote(db: Db, quoteId: string): Promise<QuoteView | null> {
  const q = await sales.getQuote(db, quoteId);
  if (!q) return null;
  const meta = q.totals as { compatVerdict?: string; shelfLifeHours?: number };
  return {
    id: q.id,
    version: q.version,
    status: q.status,
    validUntil: q.validUntil,
    sentAt: q.sentAt,
    manuallyCheckedAt: q.manuallyCheckedAt,
    watermarkDraft: q.watermarkDraft,
    settingsVersion: q.settingsVersion,
    totals: parseTotals(q.totals, q),
    compatVerdict: meta.compatVerdict ?? "incomplete",
    shelfLifeHours: typeof meta.shelfLifeHours === "number" ? meta.shelfLifeHours : null,
    pdf: { uz: q.pdfUzFileId, ru: q.pdfRuFileId },
    lines: q.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      title: l.titleSnapshot,
      categoryCode: l.categoryCode,
      feeGroup: l.feeGroup,
      qty: l.qty,
      unitSum: l.unitMarketSum,
      priceDate: l.priceDate,
      confidence: l.confidence,
      returnable: l.returnable,
      customerOwned: l.customerOwned,
      purchasedByIp: l.purchasedByIp,
    })),
  };
}

const paymentView = (p: PaymentRow): PaymentView => ({
  id: p.id,
  kind: p.kind,
  direction: p.direction,
  method: p.method,
  amountSum: p.amountSum,
  status: p.status,
  fiscalReceiptNo: p.fiscalReceiptNo,
  bankDocNo: p.bankDocNo,
  payerIsCustomer: p.payerIsCustomer,
  thirdPartyStatementFileId: p.thirdPartyStatementFileId,
  confirmedAt: p.confirmedAt,
  confirmedBy: p.confirmedBy,
  reversalOf: p.reversalOf,
  createdAt: p.createdAt,
});

async function loadPurchases(db: Db, rows: PurchaseRow[]): Promise<PurchaseView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
  const [vendors, files] = await Promise.all([
    db.$client.query<{ id: string; name: string }>("select id, name from pricing.vendors where id = any($1::uuid[])", [
      vendorIds,
    ]),
    db.$client.query<{ purchase_id: string; file_id: string; kind: string }>(
      "select purchase_id, file_id, kind from sales.purchase_files where purchase_id = any($1::uuid[])",
      [ids],
    ),
  ]);
  const names = new Map(vendors.rows.map((v) => [v.id, v.name]));
  return rows.map((p) => ({
    id: p.id,
    vendorName: names.get(p.vendorId) ?? "Магазин",
    quoteLineId: p.quoteLineId,
    qty: p.qty,
    amountSum: p.amountSum,
    discountSum: p.discountSum,
    refundOf: p.refundOf,
    paidVia: p.paidVia,
    receiptKind: p.receiptKind,
    receiptNo: p.receiptNo,
    esfNo: p.esfNo,
    esfStatus: p.esfStatus,
    esfDue: p.esfDue,
    serials: p.serials ?? [],
    vendorWarrantyUntil: p.vendorWarrantyUntil,
    boughtAt: p.boughtAt,
    boughtBy: p.boughtBy,
    files: files.rows.filter((f) => f.purchase_id === p.id).map((f) => ({ id: f.file_id, kind: f.kind })),
  }));
}

function passportView(row: Record<string, unknown> | undefined): PassportView | null {
  if (!row) return null;
  const serials = (row.serials ?? {}) as Record<string, unknown>;
  return {
    serials: Object.fromEntries(Object.entries(serials).map(([k, v]) => [k, String(v)])),
    biosVersion: (row.biosVersion as string | null) ?? null,
    os: (row.os as string | null) ?? null,
    tests: (row.tests as PassportView["tests"]) ?? null,
    photoIds: (row.photos as string[] | null) ?? [],
    sealPhotoIds: (row.sealPhotos as string[] | null) ?? [],
    labelCode: (row.labelCode as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    pdf: { uz: (row.pdfUzFileId as string | null) ?? null, ru: (row.pdfRuFileId as string | null) ?? null },
  };
}

/**
 * The objection of the customer to the latest report: open while an OBJECTION of the journal is newer than the answer of
 * the owner (`resolvedAfterSeq`, written by `reports.resolveObjection`), answered after it, null when there was none.
 */
export function objectionOf(
  events: readonly { seq: number; event: Record<string, unknown> }[],
  stored: Record<string, unknown> | null,
): ReportView["objection"] {
  const answeredThrough = typeof stored?.resolvedAfterSeq === "number" ? stored.resolvedAfterSeq : 0;
  const said = events.filter((e) => e.event.type === "OBJECTION");
  const open = said.filter((e) => e.seq > answeredThrough).at(-1);
  if (open) return { text: String(open.event.text ?? ""), resolved: false };
  if (stored && typeof stored.note === "string") return { note: stored.note, resolved: true };
  return null;
}

export async function getOrderCard(db: Db, orderId: string, opts: { seePhone: boolean }): Promise<OrderCard | null> {
  const context = await sales.loadOrderContext(db, orderId);
  if (!context) return null;
  const { order } = context;
  const customerRow = await db.query.customers.findFirst({ where: (t, { eq }) => eq(t.id, order.customerId) });
  if (!customerRow) return null;
  const lead = order.leadId
    ? await db.query.leads.findFirst({
        columns: { number: true },
        where: (t, { eq }) => eq(t.id, order.leadId as string),
      })
    : undefined;

  const [events, payments, purchaseRows, reports, acts, passport, warranty, consents, versions, quote] =
    await Promise.all([
      sales.listOrderEvents(db, orderId),
      sales.listPayments(db, orderId),
      sales.listPurchases(db, orderId),
      db.query.commissionReports.findMany({
        where: (t, { eq }) => eq(t.orderId, orderId),
        orderBy: (t, { desc }) => desc(t.version),
      }),
      db.query.acts.findMany({
        where: (t, { eq }) => eq(t.orderId, orderId),
        orderBy: (t, { asc }) => asc(t.createdAt),
      }),
      db.query.buildPassports.findFirst({ where: (t, { eq }) => eq(t.orderId, orderId) }),
      db.query.warrantyCases.findMany({
        where: (t, { eq }) => eq(t.orderId, orderId),
        orderBy: (t, { desc }) => desc(t.openedAt),
      }),
      db.query.consents.findMany({
        where: (t, { eq }) => eq(t.orderId, orderId),
        orderBy: (t, { desc }) => desc(t.at),
      }),
      db.$client.query<{ id: string; version: number; status: string; created_at: Date }>(
        "select id, version, status, created_at from sales.quotes where order_id = $1 order by version desc",
        [orderId],
      ),
      order.currentQuoteId ? loadQuote(db, order.currentQuoteId) : Promise.resolve(null),
    ]);
  const purchases = await loadPurchases(db, purchaseRows);

  // The newest row of a consent kind decides (a withdrawal is a new row).
  const seen = new Set<string>();
  const latestConsents: typeof consents = [];
  for (const c of consents) {
    if (seen.has(c.kind)) continue;
    seen.add(c.kind);
    latestConsents.push(c);
  }

  const fileIds = new Set<string>();
  for (const p of purchases) for (const f of p.files) fileIds.add(f.id);
  for (const p of payments) if (p.thirdPartyStatementFileId) fileIds.add(p.thirdPartyStatementFileId);
  for (const a of acts) {
    const id = (a.evidence as { fileId?: string } | null)?.fileId;
    if (id) fileIds.add(id);
  }
  const pass = passport as Record<string, unknown> | undefined;
  for (const id of [...((pass?.photos as string[] | null) ?? []), ...((pass?.sealPhotos as string[] | null) ?? [])]) {
    fileIds.add(id);
  }
  const fileRows =
    fileIds.size === 0
      ? { rows: [] as { id: string; kind: string; mime: string; bytes: string }[] }
      : await db.$client.query<{ id: string; kind: string; mime: string; bytes: string }>(
          "select id, kind, mime, bytes::text as bytes from ops.files where id = any($1::uuid[])",
          [[...fileIds]],
        );

  return {
    order,
    customer: {
      id: customerRow.id,
      displayName: customerRow.displayName ?? "Без имени",
      telegramUsername: customerRow.telegramUsername,
      phone: opts.seePhone ? customerRow.phoneE164 : null,
      district: customerRow.district,
      lang: customerRow.lang,
      erased: customerRow.erasedAt !== null,
    },
    leadNumber: lead?.number ?? null,
    offer: context.offer,
    quote,
    quoteVersions: versions.rows.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      createdAt: v.created_at,
    })),
    events,
    payments: payments.map(paymentView),
    purchases,
    money: {
      fundsReceived: context.money.fundsReceived,
      receiptsTotal: context.money.receiptsTotal,
      refunded: context.money.refunded,
      documentedLosses: context.money.documentedLosses,
      hasLimitOverrunConsent: context.money.hasLimitOverrunConsent,
    },
    reports: reports.map((r, index) => ({
      id: r.id,
      version: r.version,
      receivedSum: r.receivedSum,
      spentSum: r.spentSum,
      discountsSum: r.discountsSum,
      remainderSum: r.remainderSum,
      generatedAt: r.generatedAt,
      sentAt: r.sentAt,
      dueAt: r.dueAt,
      objectionUntil: r.objectionUntil,
      // The words of the customer are in the journal of events; the report keeps only the owner's answer.
      objection: index === 0 ? objectionOf(events, r.objection) : null,
      acceptedAt: r.acceptedAt,
      deemedAcceptedAt: r.deemedAcceptedAt,
      pdf: { uz: r.pdfUzFileId, ru: r.pdfRuFileId },
    })),
    acts: acts.map((a) => ({
      id: a.id,
      kind: a.kind,
      lines: (a.lines as { title: string; qty: number }[]) ?? [],
      signedAt: a.signedAt,
      signedVia: a.signedVia,
      evidenceFileId: (a.evidence as { fileId?: string } | null)?.fileId ?? null,
      createdAt: a.createdAt,
      pdf: { uz: a.pdfUzFileId, ru: a.pdfRuFileId },
    })),
    passport: passportView(pass),
    warranty: warranty.map((w) => ({
      id: w.id,
      number: w.number,
      status: w.status,
      description: w.description,
      openedAt: w.openedAt,
      dueReply: w.dueReply,
      dueDiagnosis: w.dueDiagnosis,
      dueFix: w.dueFix,
      clientFault: w.clientFault,
      closedAt: w.closedAt,
    })),
    consents: latestConsents.map((c) => ({ kind: c.kind, granted: c.granted, at: c.at })),
    files: Object.fromEntries(fileRows.rows.map((f) => [f.id, { kind: f.kind, mime: f.mime, bytes: Number(f.bytes) }])),
  };
}
