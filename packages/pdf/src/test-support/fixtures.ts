// Example data of the documents for the tests (and for a look at the paper). The estimate is counted by the domain, the same
// way the services do it, so the documents print the numbers of `computeQuote` and the tests compare with them.
import { computeQuote, DEFAULT_FEE_SETTINGS, type QuoteLineInput } from "@nivel/domain/fee";
import { sum } from "@nivel/domain/money";
import type {
  ActDoc,
  CommissionReportDoc,
  IpRequisites,
  PassportDoc,
  QuoteDoc,
  QuoteLineDoc,
  ReportLineDoc,
  WarrantyDoc,
} from "../types.ts";

export const ORDER = "NV-2026-0001";
export const CUSTOMER = "Рустам Юсупов / Rustam Yusupov";

/** A registered sole proprietor (the numbers are made up; the account is twenty digits, not a card). */
export const IP_REQUISITES: IpRequisites = {
  holder: "YaTT Karimov Aziz Baxtiyorovich",
  inn: "312345678",
  bank: "Bank «Nivel-test»",
  account: "20208000412345678001",
  mfo: "00014",
  purpose: null,
};

const LINES: readonly (QuoteLineDoc & { key: string })[] = [
  {
    key: "cpu",
    title: "AMD Ryzen 5 9600X",
    qty: 1,
    unitSum: 4_200_000,
    group: "pc",
    priceDate: "2026-10-05",
    confidence: "high",
    vendorHint: "Mycom",
    returnable: "yes",
    customerOwned: false,
    purchasedByIp: true,
  },
  {
    key: "gpu",
    title: "GeForce RTX 5070 12 GB",
    qty: 1,
    unitSum: 9_650_000,
    group: "pc",
    priceDate: "2026-10-05",
    confidence: "medium",
    returnable: "no",
    customerOwned: false,
    purchasedByIp: true,
  },
  {
    key: "ram",
    title: "DDR5 32 GB (2×16)",
    qty: 1,
    unitSum: 2_100_000,
    group: "pc",
    priceDate: "2026-10-04",
    confidence: "medium",
    returnable: "unknown",
    customerOwned: false,
    purchasedByIp: true,
  },
  {
    key: "ssd",
    title: "SSD NVMe 1 TB",
    qty: 2,
    unitSum: 1_150_000,
    group: "pc",
    priceDate: "2026-10-05",
    confidence: "high",
    returnable: "yes",
    customerOwned: false,
    purchasedByIp: true,
  },
  {
    key: "desk",
    title: "Cable duct under the desktop",
    qty: 1,
    unitSum: 480_000,
    group: "mount",
    priceDate: "2026-10-05",
    confidence: "low",
    returnable: "yes",
    customerOwned: false,
    purchasedByIp: true,
  },
  {
    key: "os",
    title: "Windows 11 Pro licence",
    qty: 1,
    unitSum: 1_900_000,
    group: "outside_scale",
    priceDate: "2026-10-05",
    confidence: "high",
    returnable: "unknown",
    customerOwned: false,
    purchasedByIp: true,
  },
  {
    key: "case",
    title: "Case of the customer",
    qty: 1,
    unitSum: 0,
    group: "pc",
    returnable: "unknown",
    customerOwned: true,
    purchasedByIp: false,
  },
];

export const NOW = new Date("2026-10-05T10:02:00.000Z");

/** The estimate of the example, counted by `computeQuote` of the domain with the default fee settings. */
export function quoteFixture(over: Partial<QuoteDoc> = {}): QuoteDoc {
  const inputs: QuoteLineInput[] = LINES.map((l) => ({
    key: l.key,
    group: l.group,
    qty: l.qty,
    unitSum: sum(l.unitSum),
    isRamOrSsd: l.key === "ram" || l.key === "ssd",
    isFurnitureLike: false,
    customerOwned: l.customerOwned,
    purchasedByIp: l.purchasedByIp,
  }));
  const t = computeQuote(inputs, DEFAULT_FEE_SETTINGS, {
    now: NOW,
    kind: "pc",
    complexBuild: false,
    freeWindowAvailable: false,
    confirmed: true,
  });
  return {
    orderNumber: ORDER,
    version: 2,
    customerName: CUSTOMER,
    issuedAt: NOW.toISOString(),
    priceDate: "2026-10-05",
    validUntil: "2026-10-06T10:02:00.000Z",
    checkedAt: "2026-10-05T10:00:00.000Z",
    fx: { ccy: "USD", rate: "11 772,95", date: "2026-10-03" },
    lines: LINES.map(({ key: _key, ...line }) => line),
    totals: {
      componentsSum: t.componentsSum,
      outsideScaleSum: t.outsideScaleSum,
      reserveBp: t.reserveBp,
      reserveSum: t.reserveSum,
      purchaseLimit: t.purchaseLimit,
      feeParts: t.fee.parts.map((p) => ({
        group: p.group,
        base: p.base,
        rateBp: p.rateBp,
        amount: p.amount,
        rule: p.rule,
      })),
      feeTotal: t.fee.total,
      feeCommissionLine: t.fee.commissionLine,
      feeWorksLine: t.fee.worksLine,
      advance: t.advance,
      final: t.final,
      grandTotal: t.grandTotal,
    },
    requisites: IP_REQUISITES,
    ...over,
  };
}

const REPORT_LINES: readonly ReportLineDoc[] = [
  {
    title: "AMD Ryzen 5 9600X",
    qty: 1,
    serials: ["CPU-9600X-001122"],
    vendor: "Mycom",
    vendorInn: "301234567",
    boughtAt: "2026-10-08T07:30:00.000Z",
    receiptKind: "fiscal",
    receiptNo: "0004457812",
    esfNo: null,
    amountSum: 4_150_000,
    vatSum: 444_643,
    discountSum: 50_000,
    bonusNote: "Cashback of the shop",
    vendorWarrantyMonths: 36,
    vendorWarrantyUntil: "2029-10-08",
    isReturn: false,
    files: 3,
  },
  {
    title: "GeForce RTX 5070 12 GB",
    qty: 1,
    serials: ["GPU-5070-778899", "BOX-5070-A12"],
    vendor: "Texnomart",
    boughtAt: "2026-10-08T09:10:00.000Z",
    receiptKind: "esf",
    receiptNo: null,
    esfNo: "ESF-2026-118342",
    amountSum: 9_500_000,
    discountSum: 0,
    vendorWarrantyMonths: 24,
    vendorWarrantyUntil: null,
    isReturn: false,
    files: 2,
  },
  {
    title: "DDR5 32 GB (2×16)",
    qty: 1,
    serials: [],
    vendor: "Mycom",
    boughtAt: "2026-10-08T10:00:00.000Z",
    receiptKind: "none_with_consent",
    receiptNo: null,
    esfNo: null,
    amountSum: 2_100_000,
    discountSum: 0,
    vendorWarrantyMonths: null,
    vendorWarrantyUntil: null,
    isReturn: false,
    files: 1,
  },
  {
    title: "DDR5 32 GB (2×16)",
    qty: 1,
    serials: [],
    vendor: "Mycom",
    boughtAt: "2026-10-09T08:00:00.000Z",
    receiptKind: "fiscal",
    receiptNo: "0004460001",
    esfNo: null,
    amountSum: -140_000,
    discountSum: 0,
    vendorWarrantyMonths: null,
    vendorWarrantyUntil: null,
    isReturn: true,
    files: 1,
  },
];

export function reportFixture(over: Partial<CommissionReportDoc> = {}): CommissionReportDoc {
  const spent = REPORT_LINES.reduce((n, l) => n + l.amountSum, 0);
  const received = 18_000_000;
  const q = quoteFixture();
  return {
    orderNumber: ORDER,
    reportVersion: 1,
    quoteVersion: 2,
    customerName: CUSTOMER,
    issuedAt: "2026-10-09T12:00:00.000Z",
    sentAt: "2026-10-09T12:30:00.000Z",
    objectionUntil: "2026-10-14T12:30:00.000Z",
    refundDueAt: "2026-10-16T12:30:00.000Z",
    ip: IP_REQUISITES,
    receivedSum: received,
    spentSum: spent,
    discountsSum: 50_000,
    remainderSum: received - spent,
    refundsSum: 140_000,
    purchaseLimit: q.totals.purchaseLimit,
    lines: REPORT_LINES,
    fee: { commissionLine: q.totals.feeCommissionLine, worksLine: q.totals.feeWorksLine, total: q.totals.feeTotal },
    feePayments: [
      { kind: "fee_advance", sum: q.totals.advance, receiptNo: "XOL-5530012", at: "2026-10-05T11:00:00.000Z" },
      { kind: "fee_final", sum: q.totals.final, receiptNo: null, at: null },
    ],
    ...over,
  };
}

export function actFixture(over: Partial<ActDoc> = {}): ActDoc {
  return {
    orderNumber: ORDER,
    customerName: CUSTOMER,
    issuedAt: "2026-10-12T08:00:00.000Z",
    lines: [
      { title: "AMD Ryzen 5 9600X", qty: 1, serial: "CPU-9600X-001122" },
      { title: "GeForce RTX 5070 12 GB", qty: 1, serial: "GPU-5070-778899" },
      { title: "Case of the customer", qty: 1 },
    ],
    receipts: [
      {
        title: "AMD Ryzen 5 9600X",
        qty: 1,
        amountSum: 4_150_000,
        receiptNo: "0004457812",
        boughtAt: "2026-10-08T07:30:00.000Z",
      },
      {
        title: "GeForce RTX 5070 12 GB",
        qty: 1,
        amountSum: 9_500_000,
        receiptNo: "ESF-2026-118342",
        boughtAt: "2026-10-08T09:10:00.000Z",
      },
    ],
    receiptsTotal: 4_150_000 + 9_500_000,
    signed: { at: "2026-10-12T09:15:00.000Z", via: "tg_button" },
    warrantyUntil: "2027-10-12",
    ip: IP_REQUISITES,
    ...over,
  };
}

export function passportFixture(over: Partial<PassportDoc> = {}): PassportDoc {
  return {
    orderNumber: ORDER,
    customerName: CUSTOMER,
    issuedAt: "2026-10-12T07:00:00.000Z",
    dates: {
      estimateAt: "2026-10-05T10:02:00.000Z",
      testsAt: "2026-10-11T19:00:00.000Z",
      actAt: "2026-10-12T09:15:00.000Z",
      warrantyUntil: "2027-10-12",
    },
    serials: [
      { label: "CPU", value: "CPU-9600X-001122" },
      { label: "GPU", value: "GPU-5070-778899" },
      { label: "Motherboard", value: "MB-B850-554433" },
      { label: "SSD", value: "SSD-1T-910011" },
    ],
    biosVersion: "F14",
    os: "Windows 11 Pro, licence by the receipt",
    tests: { tool: "OCCT + FurMark", scenario: "CPU + GPU", minutes: 420, peakTempC: 78, errors: [] },
    photos: 6,
    sealPhotos: 2,
    labelCode: "NV-0001-A7",
    notes: "Fans tuned, curve saved",
    qr: "https://nivel.uz/p/NV-0001-A7",
    ...over,
  };
}

export function warrantyFixture(over: Partial<WarrantyDoc> = {}): WarrantyDoc {
  return {
    orderNumber: ORDER,
    customerName: CUSTOMER,
    issuedAt: "2026-10-12T09:20:00.000Z",
    handedOverAt: "2026-10-12T09:15:00.000Z",
    warrantyUntil: "2027-10-12",
    ip: IP_REQUISITES,
    items: [
      { title: "AMD Ryzen 5 9600X", serial: "CPU-9600X-001122", vendorWarrantyUntil: "2029-10-08" },
      { title: "GeForce RTX 5070 12 GB", serial: "GPU-5070-778899", vendorWarrantyUntil: null },
    ],
    ...over,
  };
}
