// Rows for the tests of the job of the documents (not part of the product): one order that has walked the whole road, as the services
// leave it in the database, and a reader of rows that answers from memory. The estimate is counted by the domain, so the numbers the
// documents print are the numbers of `computeQuote`.
import { computeQuote, DEFAULT_FEE_SETTINGS, type QuoteLineInput } from "@nivel/domain/fee";
import { sum } from "@nivel/domain/money";
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
} from "../rows.ts";

export const ORDER_ID = "0199aaaa-bbbb-7ccc-8ddd-000000000001";
export const QUOTE_ID = "0199aaaa-bbbb-7ccc-8ddd-0000000000a1";
export const REPORT_ID = "0199aaaa-bbbb-7ccc-8ddd-0000000000b1";
export const ACT_ID = "0199aaaa-bbbb-7ccc-8ddd-0000000000c1";
export const OFFER_UZ = "0199aaaa-bbbb-7ccc-8ddd-0000000000d1";
export const OFFER_RU = "0199aaaa-bbbb-7ccc-8ddd-0000000000d2";
export const P1 = "0199aaaa-bbbb-7ccc-8ddd-0000000000e1";
export const P2 = "0199aaaa-bbbb-7ccc-8ddd-0000000000e2";
export const P3 = "0199aaaa-bbbb-7ccc-8ddd-0000000000e3";
export const P4 = "0199aaaa-bbbb-7ccc-8ddd-0000000000e4";
export const P5 = "0199aaaa-bbbb-7ccc-8ddd-0000000000e5";

export const T_SENT = new Date("2026-10-05T10:02:00.000Z");

export const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: ORDER_ID,
  number: "NV-2026-0001",
  currentQuoteId: QUOTE_ID,
  offerUzId: OFFER_UZ,
  offerRuId: OFFER_RU,
  warrantyUntil: new Date("2027-10-12T04:15:00.000Z"),
  handedOverAt: new Date("2026-10-12T04:15:00.000Z"),
  objectionUntil: new Date("2026-10-14T12:30:00.000Z"),
  refundDueAt: new Date("2026-10-16T12:30:00.000Z"),
  customerName: "Рустам Юсупов",
  ...over,
});

const LINES: readonly (QuoteLineRow & { key: string })[] = [
  {
    key: "cpu",
    title: "AMD Ryzen 5 9600X",
    qty: 1,
    unitSum: 4_200_000,
    feeGroup: "pc",
    priceDate: "2026-10-05",
    confidence: "high",
    returnable: "yes",
    customerOwned: false,
    purchasedByIp: true,
    vendorName: "Mycom",
    vendorPublicNameAllowed: true,
    demo: false,
  },
  {
    key: "gpu",
    title: "GeForce RTX 5070 12 GB",
    qty: 1,
    unitSum: 9_650_000,
    feeGroup: "pc",
    priceDate: "2026-10-04",
    confidence: "medium",
    returnable: "no",
    customerOwned: false,
    purchasedByIp: true,
    vendorName: "Texnomart",
    vendorPublicNameAllowed: false,
    demo: false,
  },
  {
    key: "ssd",
    title: "SSD NVMe 1 TB",
    qty: 2,
    unitSum: 1_150_000,
    feeGroup: "pc",
    priceDate: "2026-10-05",
    confidence: "high",
    returnable: "yes",
    customerOwned: false,
    purchasedByIp: true,
    vendorName: null,
    vendorPublicNameAllowed: false,
    demo: false,
  },
  {
    key: "os",
    title: "Windows 11 Pro licence",
    qty: 1,
    unitSum: 1_900_000,
    feeGroup: "outside_scale",
    priceDate: null,
    confidence: null,
    returnable: "unknown",
    customerOwned: false,
    purchasedByIp: true,
    vendorName: null,
    vendorPublicNameAllowed: false,
    demo: false,
  },
  {
    key: "case",
    title: "Case of the customer",
    qty: 1,
    unitSum: 0,
    feeGroup: "pc",
    priceDate: null,
    confidence: null,
    returnable: "unknown",
    customerOwned: true,
    purchasedByIp: false,
    vendorName: null,
    vendorPublicNameAllowed: false,
    demo: false,
  },
];

export const quoteLines = (over: Partial<QuoteLineRow> = {}): QuoteLineRow[] =>
  LINES.map(({ key: _key, ...l }) => ({ ...l, ...over }));

export function quote(over: Partial<QuoteRow> = {}): QuoteRow {
  const inputs: QuoteLineInput[] = LINES.map((l) => ({
    key: l.key,
    group: l.feeGroup,
    qty: l.qty,
    unitSum: sum(l.unitSum),
    isRamOrSsd: l.key === "ssd",
    isFurnitureLike: false,
    customerOwned: l.customerOwned,
    purchasedByIp: l.purchasedByIp,
  }));
  const t = computeQuote(inputs, DEFAULT_FEE_SETTINGS, {
    now: T_SENT,
    kind: "pc",
    complexBuild: false,
    freeWindowAvailable: false,
    confirmed: true,
  });
  return {
    id: QUOTE_ID,
    version: 2,
    // as the services store it (quotes/stored.ts): the whole result of the domain as JSON
    totals: {
      schema: 1,
      totals: JSON.parse(JSON.stringify(t)),
      compatVerdict: "ok",
      shelfLifeHours: 24,
      quoteKind: "pc",
    },
    componentsSum: t.componentsSum,
    outsideScaleSum: t.outsideScaleSum,
    reserveBp: t.reserveBp,
    reserveSum: t.reserveSum,
    purchaseLimit: t.purchaseLimit,
    feeTotal: t.fee.total,
    feeCommissionLine: t.fee.commissionLine,
    feeWorksLine: t.fee.worksLine,
    feeAdvance: t.advance,
    feeFinal: t.final,
    validUntil: new Date("2026-10-06T10:02:00.000Z"),
    createdAt: new Date("2026-10-05T09:00:00.000Z"),
    sentAt: T_SENT,
    manuallyCheckedAt: new Date("2026-10-05T10:00:00.000Z"),
    fx: { ccy: "USD", rate: "11772.9500", date: "2026-10-03" },
    ...over,
  };
}

export const purchase = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  id: P1,
  title: "AMD Ryzen 5 9600X",
  serials: ["CPU-9600X-001122"],
  vendorName: "Mycom",
  bonusNote: "Cashback of the shop",
  vendorWarrantyMonths: 36,
  vendorWarrantyUntil: "2029-10-08",
  files: 3,
  qty: 1,
  amountSum: 4_150_000,
  refundOf: null,
  receiptKind: "fiscal",
  receiptNo: "0004457812",
  esfNo: null,
  discountSum: 50_000,
  boughtAt: new Date("2026-10-08T07:30:00.000Z"),
  demo: false,
  // what is left of the purchase after the returns to the shop: the whole sum unless a test says otherwise
  netSum: over.amountSum ?? 4_150_000,
  ...over,
});

export const PURCHASES: PurchaseRow[] = [
  // 4 150 000 less the part returned to the shop (P3)
  purchase({ netSum: 4_010_000 }),
  purchase({
    id: P2,
    title: "GeForce RTX 5070 12 GB",
    serials: ["GPU-5070-778899"],
    vendorName: "Texnomart",
    bonusNote: null,
    vendorWarrantyMonths: 24,
    vendorWarrantyUntil: null,
    files: 2,
    amountSum: 9_500_000,
    receiptKind: "esf",
    receiptNo: null,
    esfNo: "ESF-2026-118342",
    discountSum: 0,
    boughtAt: new Date("2026-10-08T09:10:00.000Z"),
  }),
  purchase({
    id: P3,
    title: "AMD Ryzen 5 9600X",
    serials: [],
    vendorName: "Mycom",
    bonusNote: null,
    vendorWarrantyMonths: null,
    vendorWarrantyUntil: null,
    files: 1,
    amountSum: -140_000,
    netSum: -140_000,
    refundOf: P1,
    receiptNo: "0004460001",
    discountSum: 0,
    boughtAt: new Date("2026-10-09T08:00:00.000Z"),
  }),
];

export function report(over: Partial<ReportRow> = {}): ReportRow {
  const kept = PURCHASES;
  const spent = kept.reduce((n, p) => n + p.amountSum, 0);
  return {
    id: REPORT_ID,
    version: 1,
    receivedSum: 18_000_000,
    spentSum: spent,
    discountsSum: 50_000,
    remainderSum: 18_000_000 - spent,
    lines: kept.map((p) => ({
      purchaseId: p.id,
      productId: null,
      quoteLineId: null,
      qty: p.qty,
      amountSum: p.amountSum,
      discountSum: p.discountSum,
      receiptKind: p.receiptKind,
      receiptNo: p.receiptNo,
      esfNo: p.esfNo,
      refundOf: p.refundOf,
      boughtAt: p.boughtAt.toISOString(),
    })),
    generatedAt: new Date("2026-10-09T12:00:00.000Z"),
    sentAt: new Date("2026-10-09T12:30:00.000Z"),
    objectionUntil: new Date("2026-10-14T12:30:00.000Z"),
    acceptedAt: null,
    deemedAcceptedAt: null,
    ...over,
  };
}

export const feePayments: FeePaymentRow[] = [
  {
    kind: "fee_advance",
    sum: quote().feeAdvance,
    receiptNo: "XOL-5530012",
    confirmedAt: new Date("2026-10-05T11:00:00.000Z"),
  },
];

export const act = (over: Partial<ActRow> = {}): ActRow => ({
  id: ACT_ID,
  kind: "handover",
  lines: [
    { title: "AMD Ryzen 5 9600X", qty: 1, serial: "CPU-9600X-001122" },
    { title: "Case of the customer", qty: 1 },
  ],
  signedAt: new Date("2026-10-12T04:15:00.000Z"),
  signedVia: "tg_button",
  createdAt: new Date("2026-10-12T03:00:00.000Z"),
  ...over,
});

export const passport = (over: Partial<PassportRow> = {}): PassportRow => ({
  serials: { CPU: "CPU-9600X-001122", GPU: "GPU-5070-778899", Empty: "  " },
  biosVersion: "F14",
  os: "Windows 11 Pro, licence by the receipt",
  tests: { tool: "OCCT + FurMark", scenario: "CPU + GPU", minutes: 420, peakTempC: 78, errors: [] },
  photos: ["a", "b", "c"],
  sealPhotos: ["s"],
  labelCode: "NV-0001-A7",
  notes: "Fans tuned",
  ...over,
});

export const REQUISITES = {
  holder: "YaTT Karimov Aziz Baxtiyorovich",
  inn: "312345678",
  bank: "Bank «Nivel-test»",
  account: "20208000412345678001",
  mfo: "00014",
  purpose: "Средства комитента по заказу {number}",
};

export interface FakeData {
  order: OrderRow | null;
  /** The offers by id; an order that has fixed none gets the best of the language (`best`). */
  offers: Record<string, OfferStatus>;
  best: { uz: OfferStatus; ru: OfferStatus };
  quote: { row: QuoteRow; lines: QuoteLineRow[] } | null;
  report: ReportRow | null;
  purchases: PurchaseRow[];
  payments: FeePaymentRow[];
  acts: ActRow[];
  passport: PassportRow | null;
  settings: Record<string, unknown>;
  estimateSentAt: Date | null;
  testsPassedAt: Date | null;
  handoverSignedAt: Date | null;
}

export function fakeData(over: Partial<FakeData> = {}): FakeData {
  return {
    order: order(),
    offers: { [OFFER_UZ]: "published", [OFFER_RU]: "published" },
    best: { uz: "published", ru: "published" },
    quote: { row: quote(), lines: quoteLines() },
    report: report(),
    purchases: PURCHASES,
    payments: feePayments,
    acts: [act()],
    passport: passport(),
    settings: { "requisites.ip": REQUISITES },
    estimateSentAt: T_SENT,
    testsPassedAt: new Date("2026-10-11T14:00:00.000Z"),
    handoverSignedAt: new Date("2026-10-12T04:15:00.000Z"),
    ...over,
  };
}

/** A reader that answers from memory and counts its questions. */
export function fakeRows(data: FakeData): PdfRows & { calls: string[] } {
  const calls: string[] = [];
  const note = <T>(name: string, value: T): T => {
    calls.push(name);
    return value;
  };
  return {
    calls,
    order: async () => note("order", data.order),
    offerStatus: async (lang, fixedId) =>
      note("offers", fixedId === null ? data.best[lang] : (data.offers[fixedId] ?? "stub")),
    quote: async () => note("quote", data.quote),
    report: async () => note("report", data.report),
    purchasesByIds: async (ids) =>
      note(
        "purchasesByIds",
        data.purchases.filter((p) => ids.includes(p.id)),
      ),
    purchasesOfOrder: async () =>
      note(
        "purchasesOfOrder",
        data.purchases.filter((p) => p.refundOf === null && p.netSum > 0),
      ),
    receiptsTotal: async () =>
      note(
        "receiptsTotal",
        data.purchases.reduce((n, p) => n + p.amountSum, 0),
      ),
    sentQuoteId: async () => note("sentQuoteId", data.quote?.row.sentAt ? data.quote.row.id : null),
    feePayments: async () => note("payments", data.payments),
    act: async (_o, actId, kind) =>
      note("act", data.acts.find((a) => (actId ? a.id === actId : a.kind === kind)) ?? null),
    passport: async () => note("passport", data.passport),
    handoverSignedAt: async () => note("handoverSignedAt", data.handoverSignedAt),
    estimateSentAt: async () => note("estimateSentAt", data.estimateSentAt),
    testsPassedAt: async () => note("testsPassedAt", data.testsPassedAt),
    setting: async (key) => note("setting", data.settings[key] ?? null),
  };
}
