// Data of the documents. Plain JSON-friendly objects: the worker (apps/worker/src/jobs/pdf) reads the order from the
// database through @nivel/services and @nivel/db and hands them over; the package never computes money again, it writes
// down what the domain and the database fixed (ARCHITECTURE 6.4). Sums are whole sums, rates are basis points.

export type PdfLang = "uz" | "ru";

/** "2026-10-05". */
export type IsoDay = string;
/** A timestamp with an offset or "Z": "2026-10-05T10:02:00.000Z". */
export type IsoStamp = string;

export interface RenderOptions {
  lang: PdfLang;
  /** The offer of the order is a placeholder (not published in both languages): watermark and notice (R-25). */
  stub: boolean;
  /** The document stands on demo data (is_demo): watermark. */
  demo?: boolean;
}

/** The account of the sole proprietor (ops.settings `requisites.ip`). A missing field prints as "after registration". */
export interface IpRequisites {
  holder?: string | null;
  inn?: string | null;
  bank?: string | null;
  account?: string | null;
  mfo?: string | null;
  /** The purpose of the payment as the owner wrote it; `{number}` is replaced by the number of the order. */
  purpose?: string | null;
}

/** The money of the estimate as `QuoteTotals` of the domain fixed it (sales.quotes keeps the same numbers in its columns). */
export interface QuoteTotalsDoc {
  componentsSum: number;
  outsideScaleSum: number;
  reserveBp: number;
  reserveSum: number;
  purchaseLimit: number;
  feeParts: readonly {
    group: "pc" | "mount";
    base: number;
    rateBp: number;
    amount: number;
    rule: "pc_low" | "pc_high" | "pc_high_min" | "mount" | "complex";
  }[];
  feeTotal: number;
  feeCommissionLine: number;
  feeWorksLine: number;
  advance: number;
  final: number;
  grandTotal: number;
}

export interface QuoteLineDoc {
  title: string;
  qty: number;
  /** Whole sums: the median of the market on the date, never rounded up. */
  unitSum: number;
  group: "pc" | "mount" | "outside_scale";
  priceDate?: IsoDay | null;
  confidence?: "high" | "medium" | "low" | null;
  /** The seller of reference: the worker passes it only when the seller allows his name (pricing.vendors.public_name_allowed). */
  vendorHint?: string | null;
  returnable: "yes" | "no" | "unknown";
  customerOwned: boolean;
  purchasedByIp: boolean;
}

export interface QuoteDoc {
  orderNumber: string;
  version: number;
  customerName?: string | null;
  issuedAt: IsoStamp;
  priceDate?: IsoDay | null;
  validUntil?: IsoStamp | null;
  /** The owner has checked the estimate by hand (the stamp): the time of the check. */
  checkedAt?: IsoStamp | null;
  fx?: { ccy: string; rate: string; date: IsoDay } | null;
  lines: readonly QuoteLineDoc[];
  totals: QuoteTotalsDoc;
  requisites?: IpRequisites | null;
}

/** One purchase of the report: the snapshot of the report with what the report needs from the purchase and the catalog. */
export interface ReportLineDoc {
  title: string;
  qty: number;
  serials: readonly string[];
  /** The shop; the report is a private paper of the customer, the name is not hidden. */
  vendor?: string | null;
  vendorInn?: string | null;
  boughtAt: IsoStamp;
  receiptKind: "fiscal" | "esf" | "none_with_consent";
  receiptNo?: string | null;
  esfNo?: string | null;
  /** Negative for a return to the shop. */
  amountSum: number;
  /** VAT included in the price, when the receipt shows it. */
  vatSum?: number | null;
  discountSum: number;
  bonusNote?: string | null;
  vendorWarrantyMonths?: number | null;
  vendorWarrantyUntil?: IsoDay | null;
  isReturn: boolean;
  /** How many files (receipt, invoice, warranty card, photo of the box) are attached to the purchase. */
  files: number;
}

export interface FeePaymentDoc {
  kind: "fee_advance" | "fee_final";
  sum: number;
  /** The number of the receipt of Xolis. */
  receiptNo?: string | null;
  at?: IsoStamp | null;
}

export interface CommissionReportDoc {
  orderNumber: string;
  reportVersion: number;
  quoteVersion?: number | null;
  customerName?: string | null;
  issuedAt: IsoStamp;
  sentAt?: IsoStamp | null;
  acceptedAt?: IsoStamp | null;
  deemedAcceptedAt?: IsoStamp | null;
  /** End of the term of objections (three working days after sending). */
  objectionUntil?: IsoStamp | null;
  refundDueAt?: IsoStamp | null;
  /** The sole proprietor (the commission agent): name and taxpayer number from the requisites. */
  ip?: IpRequisites | null;
  receivedSum: number;
  spentSum: number;
  discountsSum: number;
  remainderSum: number;
  /** What the shops gave back (the sum of the returns, positive). */
  refundsSum: number;
  purchaseLimit?: number | null;
  lines: readonly ReportLineDoc[];
  fee?: { commissionLine: number; worksLine: number; total: number } | null;
  feePayments: readonly FeePaymentDoc[];
}

export type ActKind = "material_acceptance" | "customer_parts" | "handover";

export interface ActLineDoc {
  title: string;
  qty: number;
  serial?: string | null;
}

export interface ReceiptRowDoc {
  title: string;
  qty: number;
  amountSum: number;
  receiptNo?: string | null;
  boughtAt?: IsoStamp | null;
}

export interface ActDoc {
  orderNumber: string;
  customerName?: string | null;
  issuedAt: IsoStamp;
  lines: readonly ActLineDoc[];
  /** The prices by the receipts of the purchases (the act of acceptance of materials). */
  receipts?: readonly ReceiptRowDoc[];
  signed?: { at: IsoStamp; via: "tg_button" | "paper_photo" | "site_button" } | null;
  /** The act of handover: the end of the warranty. */
  warrantyUntil?: IsoDay | null;
  ip?: IpRequisites | null;
}

export interface PassportDoc {
  orderNumber: string;
  customerName?: string | null;
  issuedAt: IsoStamp;
  dates: {
    estimateAt?: IsoStamp | null;
    testsAt?: IsoStamp | null;
    actAt?: IsoStamp | null;
    warrantyUntil?: IsoDay | null;
  };
  /** Part and serial number, in the order the master wrote them. */
  serials: readonly { label: string; value: string }[];
  biosVersion?: string | null;
  os?: string | null;
  tests?: {
    tool?: string | null;
    scenario?: string | null;
    minutes?: number | null;
    peakTempC?: number | null;
    errors: readonly string[];
  } | null;
  photos: number;
  sealPhotos: number;
  labelCode?: string | null;
  notes?: string | null;
  /** The text of the QR code (a link to the page of the passport); no code is drawn without it. */
  qr?: string | null;
}

export interface WarrantyItemDoc {
  title: string;
  serial?: string | null;
  vendorWarrantyUntil?: IsoDay | null;
}

export interface WarrantyDoc {
  orderNumber: string;
  customerName?: string | null;
  issuedAt: IsoStamp;
  handedOverAt?: IsoStamp | null;
  warrantyUntil?: IsoDay | null;
  items: readonly WarrantyItemDoc[];
  /** The sole proprietor who gives the warranty: the holder of the account. */
  ip?: IpRequisites | null;
}
