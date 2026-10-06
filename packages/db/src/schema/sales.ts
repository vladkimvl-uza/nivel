import type { BuildLine, CategoryCode, FeeGroup } from "@nivel/domain/catalog";
import { PAYMENT_KINDS, PAYMENT_METHODS } from "@nivel/domain/money";
import type { Actor, OrderStatus } from "@nivel/domain/order";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, pk, sumCol, tstz, updatedAt } from "../repos/columns.ts";
import { products } from "./catalog.ts";
import { ideaPosts, legalDocuments } from "./content.ts";
import { adminUsers, files } from "./ops.ts";
import { fxRates, vendors } from "./pricing.ts";

/** PostgreSQL schema "sales" (ARCHITECTURE 3.1, 3.3). */
export const sales = pgSchema("sales");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const ORDER_STATUSES = [
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
] as const satisfies readonly OrderStatus[];
export type OrderStatusCode = (typeof ORDER_STATUSES)[number];
export const ORDER_KINDS = ["pc", "setup", "podbor", "upgrade"] as const;
/** The largest stored size (pg_column_size, bytes) of the free JSON that the public side writes into a configuration. */
export const FREE_JSON_BYTES = 16_384;
export const ACTOR_KINDS = ["system", "customer", "owner", "assistant"] as const satisfies readonly Actor[];
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "expired", "superseded"] as const;
// The lists of the payment pairs are the contract of packages/domain; the CHECKs below are generated from them.
export { PAYMENT_KINDS, PAYMENT_METHODS };
export const PAYMENT_STATUSES = ["expected", "confirmed", "void"] as const;
export const WARRANTY_STATUSES = [
  "opened",
  "diagnosing",
  "loaner_issued",
  "at_supplier",
  "resolved",
  "rejected",
  "closed",
] as const;

export const customers = sales.table(
  "customers",
  {
    id: pk(),
    displayName: text("display_name"),
    phoneE164: text("phone_e164"),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    telegramUsername: text("telegram_username"),
    lang: text("lang").$type<"uz" | "ru">().notNull().default("uz"),
    district: text("district"),
    /** Only for delivery; read by the owner role only (column grants hide it from site, bot and worker). */
    address: text("address"),
    age18Confirmed: boolean("age_18_confirmed").notNull().default(false),
    createdAt: createdAt(),
    erasedAt: tstz("erased_at"),
  },
  (t) => [
    uniqueIndex("customers_telegram_user_id_key").on(t.telegramUserId).where(sql`${t.telegramUserId} is not null`),
    uniqueIndex("customers_phone_e164_key").on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
    check("customers_lang_chk", oneOf(t.lang, ["uz", "ru"])),
    check("customers_phone_chk", sql`${t.phoneE164} is null or ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

/** AES-256-GCM ciphertext for the fallback power-of-attorney scheme only. */
export const customerSecrets = sales.table(
  "customer_secrets",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    kind: text("kind").$type<"passport_for_poa">().notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    keyVersion: integer("key_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.kind] }),
    check("customer_secrets_kind_chk", oneOf(t.kind, ["passport_for_poa"])),
  ],
);

/** Immutable once written (trigger): a change is a new configuration with parent_id. */
export const configurations = sales.table(
  "configurations",
  {
    id: pk(),
    /** 8 base32 characters, shown in /s/{code}. */
    publicCode: text("public_code").notNull(),
    kind: text("kind").$type<"pc" | "setup">().notNull(),
    parentId: uuid("parent_id"),
    items: jsonb("items").$type<BuildLine[]>().notNull().default([]),
    room: jsonb("room").$type<Record<string, unknown>>(),
    prefs: jsonb("prefs").$type<Record<string, unknown>>(),
    engineVersion: text("engine_version"),
    ruleSetVersion: integer("rule_set_version"),
    priceSnapshot: jsonb("price_snapshot").$type<Record<string, unknown>>(),
    quote: jsonb("quote").$type<Record<string, unknown>>(),
    compat: jsonb("compat").$type<Record<string, unknown>>(),
    createdVia: text("created_via").$type<"web" | "tma" | "bot" | "ai" | "admin" | "idea">().notNull(),
    ideaId: uuid("idea_id").references((): AnyPgColumn => ideaPosts.id),
    customerId: uuid("customer_id").references(() => customers.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("configurations_public_code_key").on(t.publicCode),
    index("configurations_customer_idx").on(t.customerId, t.createdAt),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "configurations_parent_fk" }),
    check("configurations_kind_chk", oneOf(t.kind, ["pc", "setup"])),
    check("configurations_code_chk", sql`${t.publicCode} ~ '^[A-Za-z0-9]{8}$'`),
    check("configurations_via_chk", oneOf(t.createdVia, ["web", "tma", "bot", "ai", "admin", "idea"])),
    check("configurations_items_chk", sql`jsonb_typeof(${t.items}) = 'array'`),
    // The free JSON of the public side, as it is stored (second line after the check of the services).
    check(
      "configurations_prefs_size_chk",
      sql`${t.prefs} is null or pg_column_size(${t.prefs}) <= ${sql.raw(String(FREE_JSON_BYTES))}`,
    ),
    check(
      "configurations_room_size_chk",
      sql`${t.room} is null or pg_column_size(${t.room}) <= ${sql.raw(String(FREE_JSON_BYTES))}`,
    ),
  ],
);

export const leads = sales.table(
  "leads",
  {
    id: pk(),
    /** L-2026-0001 */
    number: text("number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    configurationId: uuid("configuration_id").references(() => configurations.id),
    channel: text("channel").notNull(),
    utm: jsonb("utm").$type<Record<string, string>>(),
    lang: text("lang").$type<"uz" | "ru">().notNull().default("uz"),
    district: text("district"),
    wantedBy: date("wanted_by", { mode: "string" }),
    scope: text("scope").$type<"pc" | "pc_periph" | "setup" | "podbor">().notNull(),
    budgetBand: text("budget_band"),
    comment: text("comment"),
    /**
     * The contact of a request of the site that could not be linked to a customer (it used to travel in the comment).
     * Kept like the request: sales.purge_expired_leads() clears it after 12 months. The site cannot read it back.
     */
    contactPhone: text("contact_phone"),
    contactName: text("contact_name"),
    contactUsername: text("contact_username"),
    status: text("status").$type<"new" | "in_review" | "converted" | "rejected" | "spam">().notNull().default("new"),
    /** Reference-list code of the rejection reason (DECISIONS R-26 journal). */
    rejectReason: text("reject_reason"),
    tgTopicId: bigint("tg_topic_id", { mode: "number" }),
    firstResponseAt: tstz("first_response_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("leads_number_key").on(t.number),
    index("leads_status_created_idx").on(t.status, t.createdAt),
    check("leads_number_chk", sql`${t.number} ~ '^L-[0-9]{4}-[0-9]{4,}$'`),
    check("leads_status_chk", oneOf(t.status, ["new", "in_review", "converted", "rejected", "spam"])),
    check("leads_scope_chk", oneOf(t.scope, ["pc", "pc_periph", "setup", "podbor"])),
    check("leads_lang_chk", oneOf(t.lang, ["uz", "ru"])),
    check("leads_reject_chk", sql`${t.status} <> 'rejected' or ${t.rejectReason} is not null`),
    check("leads_contact_phone_chk", sql`${t.contactPhone} is null or ${t.contactPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("leads_contact_name_chk", sql`${t.contactName} is null or char_length(${t.contactName}) <= 120`),
    check("leads_contact_username_chk", sql`${t.contactUsername} is null or char_length(${t.contactUsername}) <= 64`),
  ],
);

export const orders = sales.table(
  "orders",
  {
    id: pk(),
    /** NV-2026-0001 */
    number: text("number").notNull(),
    leadId: uuid("lead_id").references(() => leads.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    /** The "sale" scheme is switched off (CONCEPT 5.11); `agency` is the fallback. */
    contractScheme: text("contract_scheme").$type<"commission" | "agency">().notNull().default("commission"),
    kind: text("kind").$type<(typeof ORDER_KINDS)[number]>().notNull(),
    slot: text("slot").$type<"regular" | "free_window">().notNull().default("regular"),
    complexBuild: boolean("complex_build").notNull().default(false),
    /** Changed only by sales.apply_transition() (trigger rejects any other change). */
    status: text("status").$type<OrderStatusCode>().notNull().default("estimate_draft"),
    feePrepaid: boolean("fee_prepaid").notNull().default(false),
    fundsReceived: boolean("funds_received").notNull().default(false),
    fundsReceivedAt: tstz("funds_received_at"),
    purchaseNotBefore: tstz("purchase_not_before"),
    firstOrderMeetingDone: boolean("first_order_meeting_done").notNull().default(false),
    currentQuoteId: uuid("current_quote_id"),
    offerVersionUzId: uuid("offer_version_uz_id").references(() => legalDocuments.id),
    offerVersionRuId: uuid("offer_version_ru_id").references(() => legalDocuments.id),
    acceptedAt: tstz("accepted_at"),
    reportDueAt: tstz("report_due_at"),
    objectionUntil: tstz("objection_until"),
    refundDueAt: tstz("refund_due_at"),
    handedOverAt: tstz("handed_over_at"),
    warrantyUntil: tstz("warranty_until"),
    /** Cancellation point, reason and CancelSettlement (ARCHITECTURE 4.7). */
    cancel: jsonb("cancel").$type<Record<string, unknown>>(),
    /** Losses with documents that reduce the refund (CancelInput.documentedLosses). */
    documentedLossesSum: sumCol("documented_losses_sum").notNull().default(0),
    podborCreditUntil: tstz("podbor_credit_until"),
    tgTopicId: bigint("tg_topic_id", { mode: "number" }),
    assignee: uuid("assignee").references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("orders_number_key").on(t.number),
    index("orders_status_idx").on(t.status),
    index("orders_customer_idx").on(t.customerId),
    // The current quote must belong to this order.
    foreignKey({
      columns: [t.currentQuoteId, t.id],
      foreignColumns: [quotes.id, quotes.orderId],
      name: "orders_current_quote_fk",
    }),
    check("orders_number_chk", sql`${t.number} ~ '^NV-[0-9]{4}-[0-9]{4,}$'`),
    check("orders_scheme_chk", oneOf(t.contractScheme, ["commission", "agency"])),
    check("orders_scheme_not_sale_chk", sql`${t.contractScheme} <> 'sale'`),
    check("orders_kind_chk", oneOf(t.kind, ORDER_KINDS)),
    check("orders_slot_chk", oneOf(t.slot, ["regular", "free_window"])),
    check("orders_status_chk", oneOf(t.status, ORDER_STATUSES)),
    check("orders_losses_chk", sql`${t.documentedLossesSum} >= 0`),
  ],
);

/** Append-only journal of status changes; written by sales.apply_transition(). */
export const orderEvents = sales.table(
  "order_events",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    seq: integer("seq").notNull(),
    at: tstz("at").notNull().defaultNow(),
    actorKind: text("actor_kind").$type<(typeof ACTOR_KINDS)[number]>().notNull(),
    actorId: text("actor_id").notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    fromStatus: text("from_status").$type<OrderStatusCode>().notNull(),
    toStatus: text("to_status").$type<OrderStatusCode>().notNull(),
    guardSnapshot: jsonb("guard_snapshot").$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.seq] }),
    check("order_events_actor_chk", oneOf(t.actorKind, ACTOR_KINDS)),
    check("order_events_from_chk", oneOf(t.fromStatus, ORDER_STATUSES)),
    check("order_events_to_chk", oneOf(t.toStatus, ORDER_STATUSES)),
    check("order_events_seq_chk", sql`${t.seq} > 0`),
  ],
);

/** Immutable after `sent` (trigger); lines are in quote_lines. */
export const quotes = sales.table(
  "quotes",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references((): AnyPgColumn => orders.id),
    version: integer("version").notNull(),
    status: text("status").$type<(typeof QUOTE_STATUSES)[number]>().notNull().default("draft"),
    /** QuoteTotals as computed by packages/domain, in full. */
    totals: jsonb("totals").$type<Record<string, unknown>>().notNull(),
    componentsSum: sumCol("components_sum").notNull(),
    reserveBp: integer("reserve_bp").notNull(),
    reserveSum: sumCol("reserve_sum").notNull(),
    purchaseLimit: sumCol("purchase_limit").notNull(),
    feeTotal: sumCol("fee_total").notNull(),
    feeCommissionLine: sumCol("fee_commission_line").notNull(),
    feeWorksLine: sumCol("fee_works_line").notNull(),
    feeAdvance: sumCol("fee_advance").notNull(),
    feeFinal: sumCol("fee_final").notNull(),
    outsideScaleSum: sumCol("outside_scale_sum").notNull().default(0),
    fxRateId: uuid("fx_rate_id").references(() => fxRates.id),
    settingsVersion: text("settings_version").notNull(),
    manuallyCheckedBy: uuid("manually_checked_by").references(() => adminUsers.id),
    manuallyCheckedAt: tstz("manually_checked_at"),
    validUntil: tstz("valid_until"),
    sentAt: tstz("sent_at"),
    acceptedAt: tstz("accepted_at"),
    /** Channel, IP hash, message id, offer versions. */
    acceptance: jsonb("acceptance").$type<Record<string, unknown>>(),
    /** Offer placeholder: the PDF carries the "not an offer" watermark. */
    watermarkDraft: boolean("watermark_draft").notNull().default(false),
    pdfUzFileId: uuid("pdf_uz_file_id").references(() => files.id),
    pdfRuFileId: uuid("pdf_ru_file_id").references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("quotes_order_version_key").on(t.orderId, t.version),
    unique("quotes_id_order_key").on(t.id, t.orderId),
    check("quotes_status_chk", oneOf(t.status, QUOTE_STATUSES)),
    check("quotes_version_chk", sql`${t.version} > 0`),
    check(
      "quotes_amounts_chk",
      sql`least(${t.componentsSum}, ${t.reserveSum}, ${t.purchaseLimit}, ${t.feeTotal}, ${t.feeCommissionLine}, ${t.feeWorksLine}, ${t.feeAdvance}, ${t.feeFinal}, ${t.outsideScaleSum}) >= 0`,
    ),
    check("quotes_reserve_bp_chk", sql`${t.reserveBp} between 0 and 10000`),
    // Two lines of defence next to packages/domain: the parts always add up to the fee.
    check("quotes_fee_split_chk", sql`${t.feeAdvance} + ${t.feeFinal} = ${t.feeTotal}`),
    check("quotes_fee_lines_chk", sql`${t.feeCommissionLine} + ${t.feeWorksLine} = ${t.feeTotal}`),
    check("quotes_limit_chk", sql`${t.purchaseLimit} >= ${t.reserveSum}`),
    // A sent estimate was checked by hand and carries its send time (ARCHITECTURE 4.9).
    check(
      "quotes_sent_chk",
      sql`${t.status} not in ('sent', 'accepted') or (${t.sentAt} is not null and ${t.manuallyCheckedBy} is not null and ${t.manuallyCheckedAt} is not null)`,
    ),
    check("quotes_accepted_chk", sql`${t.status} <> 'accepted' or ${t.acceptedAt} is not null`),
  ],
);

export const quoteLines = sales.table(
  "quote_lines",
  {
    id: pk(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    titleSnapshot: text("title_snapshot").notNull(),
    categoryCode: text("category_code").$type<CategoryCode>().notNull(),
    feeGroup: text("fee_group").$type<FeeGroup>().notNull(),
    qty: integer("qty").notNull(),
    /** Whole median of the market price, never rounded up (red line 2). */
    unitMarketSum: sumCol("unit_market_sum").notNull(),
    priceDate: date("price_date", { mode: "string" }),
    confidence: text("confidence").$type<"high" | "medium" | "low">(),
    vendorHintId: uuid("vendor_hint_id").references(() => vendors.id),
    returnable: text("returnable").$type<"yes" | "no" | "unknown">().notNull().default("unknown"),
    isRamOrSsd: boolean("is_ram_or_ssd").notNull().default(false),
    isFurnitureLike: boolean("is_furniture_like").notNull().default(false),
    customerOwned: boolean("customer_owned").notNull().default(false),
    purchasedByIp: boolean("purchased_by_ip").notNull().default(true),
  },
  (t) => [
    index("quote_lines_quote_idx").on(t.quoteId),
    check("quote_lines_qty_chk", sql`${t.qty} > 0`),
    check("quote_lines_sum_chk", sql`${t.unitMarketSum} >= 0`),
    check("quote_lines_fee_group_chk", oneOf(t.feeGroup, ["pc", "mount", "outside_scale"])),
    check("quote_lines_returnable_chk", oneOf(t.returnable, ["yes", "no", "unknown"])),
    check("quote_lines_confidence_chk", oneOf(t.confidence, ["high", "medium", "low"])),
  ],
);

/** Append-only; only `expected -> confirmed | void` is allowed to change a row (trigger). */
export const payments = sales.table(
  "payments",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    kind: text("kind").$type<(typeof PAYMENT_KINDS)[number]>().notNull(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    method: text("method").$type<(typeof PAYMENT_METHODS)[number]>().notNull(),
    /** Positive; a reversal row (reversal_of) carries the negative amount of the payment it corrects. */
    amountSum: sumCol("amount_sum").notNull(),
    status: text("status").$type<(typeof PAYMENT_STATUSES)[number]>().notNull().default("expected"),
    fiscalReceiptNo: text("fiscal_receipt_no"),
    bankDocNo: text("bank_doc_no"),
    payerIsCustomer: boolean("payer_is_customer").notNull().default(true),
    thirdPartyStatementFileId: uuid("third_party_statement_file_id").references(() => files.id),
    occurredAt: tstz("occurred_at"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: tstz("confirmed_at"),
    reversalOf: uuid("reversal_of"),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_order_kind_idx").on(t.orderId, t.kind),
    foreignKey({ columns: [t.reversalOf], foreignColumns: [t.id], name: "payments_reversal_fk" }),
    check("payments_kind_chk", oneOf(t.kind, PAYMENT_KINDS)),
    check("payments_direction_chk", oneOf(t.direction, ["in", "out"])),
    check("payments_method_chk", oneOf(t.method, PAYMENT_METHODS)),
    check("payments_status_chk", oneOf(t.status, PAYMENT_STATUSES)),
    // ARCHITECTURE 3.4: the pair "kind x method x direction" is fixed; two money streams never mix.
    check(
      "payments_purchase_funds_chk",
      sql`${t.kind} not in ('purchase_funds', 'purchase_topup') or (${t.direction} = 'in' and ${t.method} = 'bank_transfer_ip')`,
    ),
    check(
      "payments_fee_chk",
      sql`${t.kind} not in ('fee_advance', 'fee_final', 'fee_extra', 'podbor_fee') or (${t.direction} = 'in' and ${t.method} in ('xolis_qr', 'merchant_card') and (${t.status} <> 'confirmed' or coalesce(btrim(${t.fiscalReceiptNo}), '') <> ''))`,
    ),
    check(
      "payments_refund_chk",
      sql`${t.kind} not in ('remainder_refund', 'fee_refund', 'funds_refund') or (${t.direction} = 'out' and ${t.method} = 'bank_transfer_out')`,
    ),
    check(
      "payments_amount_chk",
      sql`(${t.reversalOf} is null and ${t.amountSum} > 0) or (${t.reversalOf} is not null and ${t.amountSum} < 0)`,
    ),
    check(
      "payments_confirmed_chk",
      sql`${t.status} <> 'confirmed' or (${t.confirmedAt} is not null and ${t.confirmedBy} is not null)`,
    ),
  ],
);

export const purchases = sales.table(
  "purchases",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    quoteLineId: uuid("quote_line_id").references(() => quoteLines.id),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    productId: uuid("product_id").references(() => products.id),
    qty: integer("qty").notNull(),
    /** Positive; a return to the shop (refund_of) carries the negative amount of the purchase it reduces. */
    amountSum: sumCol("amount_sum").notNull(),
    refundOf: uuid("refund_of"),
    paidVia: text("paid_via").$type<"corp_card" | "bank_transfer">().notNull(),
    receiptKind: text("receipt_kind").$type<"fiscal" | "esf" | "none_with_consent">().notNull(),
    receiptNo: text("receipt_no"),
    esfNo: text("esf_no"),
    /** Purchase date + 10 calendar days. */
    esfDue: date("esf_due", { mode: "string" }),
    esfStatus: text("esf_status").$type<"pending" | "signed" | "rejected">(),
    discountSum: sumCol("discount_sum").notNull().default(0),
    bonusNote: text("bonus_note"),
    serials: text("serials").array(),
    vendorWarrantyMonths: integer("vendor_warranty_months"),
    vendorWarrantyUntil: date("vendor_warranty_until", { mode: "string" }),
    /** GPU-Z, SMART, box photos. */
    authenticity: jsonb("authenticity").$type<Record<string, unknown>>(),
    boughtAt: tstz("bought_at").notNull().defaultNow(),
    boughtBy: text("bought_by").notNull(),
  },
  (t) => [
    index("purchases_order_idx").on(t.orderId),
    index("purchases_esf_idx").on(t.esfStatus, t.esfDue),
    index("purchases_warranty_idx").on(t.vendorWarrantyUntil),
    foreignKey({ columns: [t.refundOf], foreignColumns: [t.id], name: "purchases_refund_fk" }),
    check("purchases_paid_via_chk", oneOf(t.paidVia, ["corp_card", "bank_transfer"])),
    check("purchases_receipt_kind_chk", oneOf(t.receiptKind, ["fiscal", "esf", "none_with_consent"])),
    check("purchases_esf_status_chk", oneOf(t.esfStatus, ["pending", "signed", "rejected"])),
    check("purchases_qty_chk", sql`${t.qty} > 0`),
    check(
      "purchases_amount_chk",
      sql`(${t.refundOf} is null and ${t.amountSum} > 0) or (${t.refundOf} is not null and ${t.amountSum} < 0)`,
    ),
    check("purchases_discount_chk", sql`${t.discountSum} >= 0`),
    check("purchases_fiscal_chk", sql`${t.receiptKind} <> 'fiscal' or ${t.receiptNo} is not null`),
    check("purchases_esf_chk", sql`${t.receiptKind} <> 'esf' or ${t.esfStatus} is not null`),
  ],
);

export const purchaseFiles = sales.table(
  "purchase_files",
  {
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    kind: text("kind").$type<"receipt" | "box_serial" | "seal" | "warranty_card">().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.purchaseId, t.fileId] }),
    check("purchase_files_kind_chk", oneOf(t.kind, ["receipt", "box_serial", "seal", "warranty_card"])),
  ],
);

export const commissionReports = sales.table(
  "commission_reports",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    version: integer("version").notNull(),
    receivedSum: sumCol("received_sum").notNull(),
    spentSum: sumCol("spent_sum").notNull(),
    discountsSum: sumCol("discounts_sum").notNull().default(0),
    remainderSum: sumCol("remainder_sum").notNull(),
    /** Snapshot of the purchases at generation time. */
    lines: jsonb("lines").$type<unknown[]>().notNull(),
    generatedAt: tstz("generated_at").notNull().defaultNow(),
    sentAt: tstz("sent_at"),
    dueAt: tstz("due_at"),
    /** Send time + 3 working days. */
    objectionUntil: tstz("objection_until"),
    objection: jsonb("objection").$type<Record<string, unknown>>(),
    acceptedAt: tstz("accepted_at"),
    deemedAcceptedAt: tstz("deemed_accepted_at"),
    pdfUzFileId: uuid("pdf_uz_file_id").references(() => files.id),
    pdfRuFileId: uuid("pdf_ru_file_id").references(() => files.id),
  },
  (t) => [
    unique("commission_reports_order_version_key").on(t.orderId, t.version),
    check("commission_reports_sums_chk", sql`${t.receivedSum} - ${t.spentSum} = ${t.remainderSum}`),
    check("commission_reports_version_chk", sql`${t.version} > 0`),
  ],
);

export const acts = sales.table(
  "acts",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    kind: text("kind").$type<"material_acceptance" | "customer_parts" | "handover">().notNull(),
    lines: jsonb("lines").$type<unknown[]>().notNull().default([]),
    signedAt: tstz("signed_at"),
    signedVia: text("signed_via").$type<"tg_button" | "paper_photo" | "site_button">(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    pdfUzFileId: uuid("pdf_uz_file_id").references(() => files.id),
    pdfRuFileId: uuid("pdf_ru_file_id").references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("acts_order_kind_idx").on(t.orderId, t.kind),
    check("acts_kind_chk", oneOf(t.kind, ["material_acceptance", "customer_parts", "handover"])),
    check("acts_signed_via_chk", oneOf(t.signedVia, ["tg_button", "paper_photo", "site_button"])),
    check("acts_signed_chk", sql`(${t.signedAt} is null) = (${t.signedVia} is null)`),
    // A signature always rests on evidence (the id of the press, the file of the paper act).
    check("acts_evidence_chk", sql`${t.signedAt} is null or ${t.evidence} is not null`),
  ],
);

export const buildPassports = sales.table("build_passports", {
  orderId: uuid("order_id")
    .primaryKey()
    .references(() => orders.id),
  serials: jsonb("serials").$type<Record<string, unknown>>().notNull().default({}),
  biosVersion: text("bios_version"),
  /** Windows licence by the receipt. */
  os: text("os"),
  /** Tool, scenario, minutes, peak temperatures, errors. */
  tests: jsonb("tests").$type<Record<string, unknown>>(),
  photos: jsonb("photos").$type<string[]>(),
  sealPhotos: jsonb("seal_photos").$type<string[]>(),
  labelCode: text("label_code"),
  notes: text("notes"),
  pdfUzFileId: uuid("pdf_uz_file_id").references(() => files.id),
  pdfRuFileId: uuid("pdf_ru_file_id").references(() => files.id),
});

export const loanerItems = sales.table(
  "loaner_items",
  {
    id: pk(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    serial: text("serial"),
    status: text("status").$type<"available" | "issued" | "repair">().notNull().default("available"),
    ownerCostSum: sumCol("owner_cost_sum"),
  },
  (t) => [check("loaner_items_status_chk", oneOf(t.status, ["available", "issued", "repair"]))],
);

export const warrantyCases = sales.table(
  "warranty_cases",
  {
    id: pk(),
    /** G-2026-0001 */
    number: text("number").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    purchaseId: uuid("purchase_id").references(() => purchases.id),
    openedAt: tstz("opened_at").notNull().defaultNow(),
    channel: text("channel"),
    description: text("description").notNull(),
    dueReply: tstz("due_reply"),
    dueDiagnosis: tstz("due_diagnosis"),
    dueLoaner: tstz("due_loaner"),
    dueFix: tstz("due_fix"),
    loanerItemId: uuid("loaner_item_id").references(() => loanerItems.id),
    vendorClaim: jsonb("vendor_claim").$type<Record<string, unknown>>(),
    costFromReserveSum: sumCol("cost_from_reserve_sum").notNull().default(0),
    /** Refusal needs a causal link: impact, liquid, overclocking, replacement by someone else. */
    clientFault: text("client_fault").$type<"impact" | "liquid" | "overclocking" | "third_party_replacement">(),
    status: text("status").$type<(typeof WARRANTY_STATUSES)[number]>().notNull().default("opened"),
    closedAt: tstz("closed_at"),
  },
  (t) => [
    unique("warranty_cases_number_key").on(t.number),
    index("warranty_cases_status_idx").on(t.status),
    index("warranty_cases_order_idx").on(t.orderId),
    check("warranty_cases_number_chk", sql`${t.number} ~ '^G-[0-9]{4}-[0-9]{4,}$'`),
    check("warranty_cases_status_chk", oneOf(t.status, WARRANTY_STATUSES)),
    check(
      "warranty_cases_fault_chk",
      oneOf(t.clientFault, ["impact", "liquid", "overclocking", "third_party_replacement"]),
    ),
    check("warranty_cases_rejected_chk", sql`${t.status} <> 'rejected' or ${t.clientFault} is not null`),
    check("warranty_cases_cost_chk", sql`${t.costFromReserveSum} >= 0`),
  ],
);

/** Append-only: warranty and tax-risk funds. A correction is a reversing row. */
export const reserveLedger = sales.table(
  "reserve_ledger",
  {
    id: pk(),
    fund: text("fund").$type<"warranty" | "tax_risk">().notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    /** Signed: contributions are positive, spending and reversals negative. */
    amountSum: sumCol("amount_sum").notNull(),
    reason: text("reason").notNull(),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    index("reserve_ledger_fund_at_idx").on(t.fund, t.at),
    check("reserve_ledger_fund_chk", oneOf(t.fund, ["warranty", "tax_risk"])),
    check("reserve_ledger_amount_chk", sql`${t.amountSum} <> 0`),
  ],
);

/** Income of the sole proprietor's other activity: counts toward the annual threshold (DECISIONS R-5). */
export const otherIncome = sales.table(
  "other_income",
  {
    id: pk(),
    year: integer("year").notNull(),
    period: text("period").notNull(),
    amountSum: sumCol("amount_sum").notNull(),
    kind: text("kind").$type<"other_ip_activity">().notNull().default("other_ip_activity"),
    note: text("note"),
    enteredBy: text("entered_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("other_income_year_idx").on(t.year),
    check("other_income_kind_chk", oneOf(t.kind, ["other_ip_activity"])),
    check("other_income_amount_chk", sql`${t.amountSum} > 0`),
  ],
);
