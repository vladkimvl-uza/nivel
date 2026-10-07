// What the job of the documents reads from the database with the rights of nivel_worker (SELECT on the sales tables without the
// address of a customer, on catalog, pricing and content). The rows are plain data: the sums are whole numbers (bigint columns are
// read as text and checked), the times are dates. `build.ts` turns them into the data of the documents; nothing here is counted.
import type { Db } from "@nivel/db";
import { BuildDataError } from "./errors.ts";

export type OfferStatus = "stub" | "lawyer_approved" | "published";

export interface OrderRow {
  id: string;
  number: string;
  currentQuoteId: string | null;
  offerUzId: string | null;
  offerRuId: string | null;
  warrantyUntil: Date | null;
  handedOverAt: Date | null;
  objectionUntil: Date | null;
  refundDueAt: Date | null;
  customerName: string | null;
}

export interface QuoteRow {
  id: string;
  version: number;
  /** The whole result of the domain as the services store it: { schema, totals: QuoteTotals, ... }. */
  totals: unknown;
  componentsSum: number;
  outsideScaleSum: number;
  reserveBp: number;
  reserveSum: number;
  purchaseLimit: number;
  feeTotal: number;
  feeCommissionLine: number;
  feeWorksLine: number;
  feeAdvance: number;
  feeFinal: number;
  validUntil: Date | null;
  createdAt: Date;
  sentAt: Date | null;
  manuallyCheckedAt: Date | null;
  fx: { ccy: string; rate: string; date: string } | null;
}

export interface QuoteLineRow {
  title: string;
  qty: number;
  unitSum: number;
  feeGroup: "pc" | "mount" | "outside_scale";
  priceDate: string | null;
  confidence: "high" | "medium" | "low" | null;
  returnable: "yes" | "no" | "unknown";
  customerOwned: boolean;
  purchasedByIp: boolean;
  vendorName: string | null;
  vendorPublicNameAllowed: boolean;
  demo: boolean;
}

export interface ReportRow {
  id: string;
  version: number;
  receivedSum: number;
  spentSum: number;
  discountsSum: number;
  remainderSum: number;
  /** The snapshot of the purchases made when the report was generated. */
  lines: unknown;
  generatedAt: Date;
  sentAt: Date | null;
  objectionUntil: Date | null;
  acceptedAt: Date | null;
  deemedAcceptedAt: Date | null;
}

export interface PurchaseRow {
  id: string;
  title: string | null;
  serials: string[];
  vendorName: string | null;
  bonusNote: string | null;
  vendorWarrantyMonths: number | null;
  vendorWarrantyUntil: string | null;
  files: number;
  qty: number;
  /** As written on the receipt; a return to the shop is a row of its own with a negative sum (`refundOf`). */
  amountSum: number;
  /** What is left of the purchase once the returns to the shop are taken off: the sum the customer really paid for it. */
  netSum: number;
  refundOf: string | null;
  receiptKind: "fiscal" | "esf" | "none_with_consent";
  receiptNo: string | null;
  esfNo: string | null;
  discountSum: number;
  boughtAt: Date;
  demo: boolean;
}

export interface FeePaymentRow {
  kind: "fee_advance" | "fee_final";
  sum: number;
  receiptNo: string | null;
  confirmedAt: Date | null;
}

export interface ActRow {
  id: string;
  kind: "material_acceptance" | "customer_parts" | "handover";
  lines: unknown;
  signedAt: Date | null;
  signedVia: "tg_button" | "paper_photo" | "site_button" | null;
  createdAt: Date;
}

export interface PassportRow {
  serials: unknown;
  biosVersion: string | null;
  os: string | null;
  tests: unknown;
  photos: unknown;
  sealPhotos: unknown;
  labelCode: string | null;
  notes: string | null;
}

export interface PdfRows {
  order(orderId: string): Promise<OrderRow | null>;
  /**
   * The offer the order stands on in a language: the version the order has fixed, or, before the acceptance, the best there is
   * (published over approved over a stub, the newest first), as the services choose it when they send the estimate.
   */
  offerStatus(lang: "uz" | "ru", fixedId: string | null): Promise<OfferStatus>;
  quote(quoteId: string): Promise<{ row: QuoteRow; lines: QuoteLineRow[] } | null>;
  /** The newest estimate of the order that has gone out to the customer (a draft is nobody's paper), or null. */
  sentQuoteId(orderId: string): Promise<string | null>;
  /** The latest version of the report of the order. */
  report(orderId: string): Promise<ReportRow | null>;
  /** The purchases of the order with these ids (the snapshot of the report); an id of another order finds nothing. */
  purchasesByIds(ids: readonly string[], orderId: string): Promise<PurchaseRow[]>;
  /**
   * What the order has bought and kept, in the order the purchases were made: the returns to the shops are not rows of their own
   * but taken off the purchase they belong to (`netSum`), and a purchase that was returned whole is not here at all.
   */
  purchasesOfOrder(orderId: string): Promise<PurchaseRow[]>;
  /** The sum of all the purchases of the order, the returns included: what the report calls "spent". */
  receiptsTotal(orderId: string): Promise<number>;
  /** The fee that stands paid: a payment less its reversals, and none that was reversed whole; the newest of a kind last. */
  feePayments(orderId: string): Promise<FeePaymentRow[]>;
  act(orderId: string, actId: string | null, kind: ActRow["kind"] | null): Promise<ActRow | null>;
  passport(orderId: string): Promise<PassportRow | null>;
  /** The day the customer signed the act of handover. */
  handoverSignedAt(orderId: string): Promise<Date | null>;
  /** The estimate of the order: when it was sent (the first quote of the order that is not a draft). */
  estimateSentAt(orderId: string): Promise<Date | null>;
  /** When the tests were passed (the event TESTS_PASSED of the order). */
  testsPassedAt(orderId: string): Promise<Date | null>;
  setting(key: string): Promise<unknown>;
}

const toInt = (v: unknown, label: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n))
    throw new BuildDataError(`${label}: ${String(v)} is not a whole number`);
  return n;
};

type Q = Db["$client"];

/** The Postgres reader: raw SQL on the pool of the worker (the bigint columns come as text, `::text` makes it plain). */
export function createPgPdfRows(db: Db): PdfRows {
  const q: Q = db.$client;
  const all = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await q.query(sql, params)).rows as T[];
  const purchaseSql = `
    select p.id, coalesce(ql.title_snapshot, nullif(btrim(pr.brand || ' ' || pr.model), '')) as title, p.serials,
           v.name as vendor_name, p.bonus_note, p.vendor_warranty_months, p.vendor_warranty_until::text as vendor_warranty_until,
           (select count(*) from sales.purchase_files pf where pf.purchase_id = p.id)::int as files,
           p.qty, p.amount_sum::text as amount_sum,
           (p.amount_sum + coalesce((select sum(r.amount_sum) from sales.purchases r where r.refund_of = p.id), 0))::text as net_sum,
           p.refund_of, p.receipt_kind, p.receipt_no, p.esf_no,
           p.discount_sum::text as discount_sum, p.bought_at, (coalesce(v.is_demo, false) or coalesce(pr.is_demo, false)) as demo
      from sales.purchases p
      left join sales.quote_lines ql on ql.id = p.quote_line_id
      left join catalog.products pr on pr.id = p.product_id
      left join pricing.vendors v on v.id = p.vendor_id`;
  const purchase = (r: Record<string, unknown>): PurchaseRow => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    serials: (r.serials as string[] | null) ?? [],
    vendorName: (r.vendor_name as string | null) ?? null,
    bonusNote: (r.bonus_note as string | null) ?? null,
    vendorWarrantyMonths: (r.vendor_warranty_months as number | null) ?? null,
    vendorWarrantyUntil: (r.vendor_warranty_until as string | null) ?? null,
    files: Number(r.files),
    qty: Number(r.qty),
    amountSum: toInt(r.amount_sum, "purchase amount"),
    netSum: toInt(r.net_sum, "purchase net amount"),
    refundOf: (r.refund_of as string | null) ?? null,
    receiptKind: r.receipt_kind as PurchaseRow["receiptKind"],
    receiptNo: (r.receipt_no as string | null) ?? null,
    esfNo: (r.esf_no as string | null) ?? null,
    discountSum: toInt(r.discount_sum, "purchase discount"),
    boughtAt: r.bought_at as Date,
    demo: r.demo === true,
  });
  return {
    async order(orderId) {
      const [r] = await all<Record<string, unknown>>(
        `select o.id, o.number, o.current_quote_id, o.offer_version_uz_id, o.offer_version_ru_id,
                o.warranty_until, o.handed_over_at, o.objection_until, o.refund_due_at, c.display_name
           from sales.orders o join sales.customers c on c.id = o.customer_id where o.id = $1`,
        [orderId],
      );
      if (!r) return null;
      return {
        id: r.id as string,
        number: r.number as string,
        currentQuoteId: (r.current_quote_id as string | null) ?? null,
        offerUzId: (r.offer_version_uz_id as string | null) ?? null,
        offerRuId: (r.offer_version_ru_id as string | null) ?? null,
        warrantyUntil: (r.warranty_until as Date | null) ?? null,
        handedOverAt: (r.handed_over_at as Date | null) ?? null,
        objectionUntil: (r.objection_until as Date | null) ?? null,
        refundDueAt: (r.refund_due_at as Date | null) ?? null,
        customerName: (r.display_name as string | null) ?? null,
      };
    },
    async offerStatus(lang, fixedId) {
      const [r] = await all<{ status: OfferStatus }>(
        `select status from content.legal_documents
          where kind = 'offer' and lang = $1 and ($2::uuid is null or id = $2::uuid)
          order by case status when 'published' then 2 when 'lawyer_approved' then 1 else 0 end desc, created_at desc limit 1`,
        [lang, fixedId],
      );
      return r?.status ?? "stub";
    },
    async sentQuoteId(orderId) {
      const [r] = await all<{ id: string }>(
        "select id from sales.quotes where order_id = $1 and sent_at is not null order by version desc limit 1",
        [orderId],
      );
      return r?.id ?? null;
    },
    async quote(quoteId) {
      const [r] = await all<Record<string, unknown>>(
        `select q.id, q.version, q.totals, q.components_sum::text, q.outside_scale_sum::text, q.reserve_bp, q.reserve_sum::text,
                q.purchase_limit::text, q.fee_total::text, q.fee_commission_line::text, q.fee_works_line::text,
                q.fee_advance::text, q.fee_final::text, q.valid_until, q.created_at, q.sent_at, q.manually_checked_at,
                fx.ccy as fx_ccy, fx.rate::text as fx_rate, fx.effective_date::text as fx_date
           from sales.quotes q left join pricing.fx_rates fx on fx.id = q.fx_rate_id where q.id = $1`,
        [quoteId],
      );
      if (!r) return null;
      const lines = await all<Record<string, unknown>>(
        `select l.title_snapshot, l.qty, l.unit_market_sum::text, l.fee_group, l.price_date::text, l.confidence, l.returnable,
                l.customer_owned, l.purchased_by_ip, v.name as vendor_name, coalesce(v.public_name_allowed, false) as allowed,
                (coalesce(v.is_demo, false) or coalesce(p.is_demo, false)) as demo
           from sales.quote_lines l
           left join pricing.vendors v on v.id = l.vendor_hint_id
           left join catalog.products p on p.id = l.product_id
          where l.quote_id = $1 order by l.id`,
        [quoteId],
      );
      return {
        row: {
          id: r.id as string,
          version: Number(r.version),
          totals: r.totals,
          componentsSum: toInt(r.components_sum, "components_sum"),
          outsideScaleSum: toInt(r.outside_scale_sum, "outside_scale_sum"),
          reserveBp: Number(r.reserve_bp),
          reserveSum: toInt(r.reserve_sum, "reserve_sum"),
          purchaseLimit: toInt(r.purchase_limit, "purchase_limit"),
          feeTotal: toInt(r.fee_total, "fee_total"),
          feeCommissionLine: toInt(r.fee_commission_line, "fee_commission_line"),
          feeWorksLine: toInt(r.fee_works_line, "fee_works_line"),
          feeAdvance: toInt(r.fee_advance, "fee_advance"),
          feeFinal: toInt(r.fee_final, "fee_final"),
          validUntil: (r.valid_until as Date | null) ?? null,
          createdAt: r.created_at as Date,
          sentAt: (r.sent_at as Date | null) ?? null,
          manuallyCheckedAt: (r.manually_checked_at as Date | null) ?? null,
          fx: r.fx_ccy ? { ccy: r.fx_ccy as string, rate: r.fx_rate as string, date: r.fx_date as string } : null,
        },
        lines: lines.map((l) => ({
          title: l.title_snapshot as string,
          qty: Number(l.qty),
          unitSum: toInt(l.unit_market_sum, "unit_market_sum"),
          feeGroup: l.fee_group as QuoteLineRow["feeGroup"],
          priceDate: (l.price_date as string | null) ?? null,
          confidence: (l.confidence as QuoteLineRow["confidence"]) ?? null,
          returnable: l.returnable as QuoteLineRow["returnable"],
          customerOwned: l.customer_owned === true,
          purchasedByIp: l.purchased_by_ip === true,
          vendorName: (l.vendor_name as string | null) ?? null,
          vendorPublicNameAllowed: l.allowed === true,
          demo: l.demo === true,
        })),
      };
    },
    async report(orderId) {
      const [r] = await all<Record<string, unknown>>(
        `select id, version, received_sum::text, spent_sum::text, discounts_sum::text, remainder_sum::text, lines, generated_at,
                sent_at, objection_until, accepted_at, deemed_accepted_at
           from sales.commission_reports where order_id = $1 order by version desc limit 1`,
        [orderId],
      );
      if (!r) return null;
      return {
        id: r.id as string,
        version: Number(r.version),
        receivedSum: toInt(r.received_sum, "received_sum"),
        spentSum: toInt(r.spent_sum, "spent_sum"),
        discountsSum: toInt(r.discounts_sum, "discounts_sum"),
        remainderSum: toInt(r.remainder_sum, "remainder_sum"),
        lines: r.lines,
        generatedAt: r.generated_at as Date,
        sentAt: (r.sent_at as Date | null) ?? null,
        objectionUntil: (r.objection_until as Date | null) ?? null,
        acceptedAt: (r.accepted_at as Date | null) ?? null,
        deemedAcceptedAt: (r.deemed_accepted_at as Date | null) ?? null,
      };
    },
    async purchasesByIds(ids, orderId) {
      if (ids.length === 0) return [];
      return (
        await all<Record<string, unknown>>(`${purchaseSql} where p.order_id = $2 and p.id = any($1::uuid[])`, [
          ids,
          orderId,
        ])
      ).map(purchase);
    },
    async purchasesOfOrder(orderId) {
      return (
        await all<Record<string, unknown>>(
          `select * from (${purchaseSql} where p.order_id = $1 and p.refund_of is null) kept
            where kept.net_sum::bigint > 0 order by kept.bought_at, kept.id`,
          [orderId],
        )
      ).map(purchase);
    },
    async receiptsTotal(orderId) {
      const [r] = await all<{ total: string }>(
        "select coalesce(sum(amount_sum), 0)::text as total from sales.purchases where order_id = $1",
        [orderId],
      );
      return toInt(r?.total ?? "0", "receipts total");
    },
    async feePayments(orderId) {
      // A confirmed payment is never edited: a mistake is mended by a row of the negative sum that points at it (`reversal_of`),
      // so what stands paid is the payment less its reversals; one that was reversed whole stands for nothing.
      const rows = await all<Record<string, unknown>>(
        `select * from (
           select p.kind, p.fiscal_receipt_no, p.confirmed_at,
                  (p.amount_sum + coalesce((select sum(r.amount_sum) from sales.payments r
                                             where r.reversal_of = p.id and r.status = 'confirmed'), 0))::text as net_sum
             from sales.payments p
            where p.order_id = $1 and p.kind in ('fee_advance', 'fee_final') and p.status = 'confirmed' and p.reversal_of is null
         ) standing where standing.net_sum::bigint > 0 order by standing.confirmed_at, standing.fiscal_receipt_no`,
        [orderId],
      );
      return rows.map((r) => ({
        kind: r.kind as FeePaymentRow["kind"],
        sum: toInt(r.net_sum, "payment amount"),
        receiptNo: (r.fiscal_receipt_no as string | null) ?? null,
        confirmedAt: (r.confirmed_at as Date | null) ?? null,
      }));
    },
    async act(orderId, actId, kind) {
      const [r] = await all<Record<string, unknown>>(
        actId
          ? "select id, kind, lines, signed_at, signed_via, created_at from sales.acts where id = $1 and order_id = $2"
          : "select id, kind, lines, signed_at, signed_via, created_at from sales.acts where order_id = $2 and kind = $1 order by created_at desc limit 1",
        actId ? [actId, orderId] : [kind, orderId],
      );
      if (!r) return null;
      return {
        id: r.id as string,
        kind: r.kind as ActRow["kind"],
        lines: r.lines,
        signedAt: (r.signed_at as Date | null) ?? null,
        signedVia: (r.signed_via as ActRow["signedVia"]) ?? null,
        createdAt: r.created_at as Date,
      };
    },
    async passport(orderId) {
      const [r] = await all<Record<string, unknown>>(
        "select serials, bios_version, os, tests, photos, seal_photos, label_code, notes from sales.build_passports where order_id = $1",
        [orderId],
      );
      if (!r) return null;
      return {
        serials: r.serials,
        biosVersion: (r.bios_version as string | null) ?? null,
        os: (r.os as string | null) ?? null,
        tests: r.tests,
        photos: r.photos,
        sealPhotos: r.seal_photos,
        labelCode: (r.label_code as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
      };
    },
    async handoverSignedAt(orderId) {
      const [r] = await all<{ signed_at: Date | null }>(
        "select signed_at from sales.acts where order_id = $1 and kind = 'handover' and signed_at is not null order by signed_at desc limit 1",
        [orderId],
      );
      return r?.signed_at ?? null;
    },
    async estimateSentAt(orderId) {
      const [r] = await all<{ sent_at: Date | null }>(
        "select min(sent_at) as sent_at from sales.quotes where order_id = $1 and sent_at is not null",
        [orderId],
      );
      return r?.sent_at ?? null;
    },
    async testsPassedAt(orderId) {
      const [r] = await all<{ at: Date | null }>(
        "select at from sales.order_events where order_id = $1 and event->>'type' = 'TESTS_PASSED' order by seq desc limit 1",
        [orderId],
      );
      return r?.at ?? null;
    },
    async setting(key) {
      const [r] = await all<{ value: unknown }>("select value from ops.settings where key = $1", [key]);
      return r?.value ?? null;
    },
  };
}

export { toInt };
