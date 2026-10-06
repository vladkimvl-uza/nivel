import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, pk, sumCol, tstz } from "../repos/columns.ts";
import { products } from "./catalog.ts";
import { adminUsers, files } from "./ops.ts";

/** PostgreSQL schema "pricing" (ARCHITECTURE 3.1, 3.3). */
export const pricing = pgSchema("pricing");

export const VENDOR_KINDS = ["partner", "shop", "marketplace_seller", "private"] as const;
export const PRICE_SOURCES = ["partner_sheet", "csv", "telegram", "manual", "scrape_allowed"] as const;
export const AVAILABILITY = ["in_stock", "on_order", "preorder", "ask"] as const;
export const CONDITIONS = ["new", "refurb", "used"] as const;
export const OBSERVATION_SOURCES = ["partner_csv", "partner_gsheet", "partner_tg", "manual", "scrape"] as const;
export const EXCLUDE_REASONS = [
  "outlier",
  "currency_error",
  "stale",
  "not_in_stock",
  "from_price",
  "private_seller",
  "duplicate_vendor",
  "used_or_refurb",
  "manual",
] as const;

export const fxRates = pricing.table(
  "fx_rates",
  {
    id: pk(),
    ccy: text("ccy").$type<"USD" | "EUR" | "RUB">().notNull(),
    /** Exchange rate with four decimals; parsed from a string, never through a float. */
    rate: numeric("rate", { precision: 14, scale: 4 }).notNull(),
    nominal: integer("nominal").notNull().default(1),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    fetchedAt: tstz("fetched_at").notNull().defaultNow(),
    source: text("source").$type<"cbu_json" | "cbu_xml" | "manual">().notNull(),
    diff: numeric("diff", { precision: 14, scale: 4 }),
  },
  (t) => [
    unique("fx_rates_ccy_date_key").on(t.ccy, t.effectiveDate),
    check("fx_rates_ccy_chk", oneOf(t.ccy, ["USD", "EUR", "RUB"])),
    check("fx_rates_source_chk", oneOf(t.source, ["cbu_json", "cbu_xml", "manual"])),
    check("fx_rates_rate_chk", sql`${t.rate} > 0 and ${t.nominal} > 0`),
  ],
);

export const vendors = pricing.table(
  "vendors",
  {
    id: pk(),
    name: text("name").notNull(),
    kind: text("kind").$type<(typeof VENDOR_KINDS)[number]>().notNull(),
    site: text("site"),
    publicNameAllowed: boolean("public_name_allowed").notNull().default(false),
    priceSource: text("price_source").$type<(typeof PRICE_SOURCES)[number]>().notNull(),
    sheetCsvUrl: text("sheet_csv_url"),
    termsCheckedAt: tstz("terms_checked_at"),
    issuesFiscalReceipt: boolean("issues_fiscal_receipt"),
    esfAvailable: boolean("esf_available"),
    acceptsCorpCard: boolean("accepts_corp_card"),
    returnDays: integer("return_days"),
    assemblyKeepsWarranty: boolean("assembly_keeps_warranty"),
    acceptsClaimsFromIp: boolean("accepts_claims_from_ip"),
    agreementFileId: uuid("agreement_file_id").references(() => files.id),
    /** Working contact only; no personal phone numbers of private sellers. */
    contact: text("contact"),
    status: text("status").$type<"active" | "paused" | "archived">().notNull().default("active"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("vendors_name_key").on(t.name),
    check("vendors_kind_chk", oneOf(t.kind, VENDOR_KINDS)),
    check("vendors_price_source_chk", oneOf(t.priceSource, PRICE_SOURCES)),
    check("vendors_status_chk", oneOf(t.status, ["active", "paused", "archived"])),
    check("vendors_return_days_chk", sql`${t.returnDays} is null or ${t.returnDays} >= 0`),
  ],
);

export const offers = pricing.table(
  "offers",
  {
    id: pk(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    /** Null until the vendor line is matched to a catalog position. */
    productId: uuid("product_id").references(() => products.id),
    vendorSku: text("vendor_sku").notNull(),
    rawTitle: text("raw_title").notNull(),
    mpn: text("mpn"),
    ean: text("ean"),
    url: text("url"),
    condition: text("condition").$type<(typeof CONDITIONS)[number]>().notNull().default("new"),
    matchStatus: text("match_status")
      .$type<"auto" | "manual" | "unmatched" | "rejected">()
      .notNull()
      .default("unmatched"),
    matchedBy: uuid("matched_by").references(() => adminUsers.id),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("offers_vendor_sku_key").on(t.vendorId, t.vendorSku),
    index("offers_product_idx").on(t.productId),
    check("offers_condition_chk", oneOf(t.condition, CONDITIONS)),
    check("offers_match_status_chk", oneOf(t.matchStatus, ["auto", "manual", "unmatched", "rejected"])),
  ],
);

/** Memory of "price line to catalog position" so a repeated import matches without a human. */
export const skuMappings = pricing.table(
  "sku_mappings",
  {
    id: pk(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    vendorSku: text("vendor_sku").notNull(),
    rawTitleNormalized: text("raw_title_normalized").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    confirmedBy: uuid("confirmed_by").references(() => adminUsers.id),
    confirmedAt: tstz("confirmed_at"),
  },
  (t) => [unique("sku_mappings_vendor_sku_key").on(t.vendorId, t.vendorSku)],
);

export const priceImports = pricing.table(
  "price_imports",
  {
    id: pk(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    format: text("format").$type<"csv" | "gsheet_csv" | "xlsx" | "tg_post" | "manual">().notNull(),
    fileId: uuid("file_id").references(() => files.id),
    url: text("url"),
    status: text("status").$type<"pending" | "preview" | "applied" | "failed">().notNull().default("pending"),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsMatched: integer("rows_matched").notNull().default(0),
    rowsUnmatched: integer("rows_unmatched").notNull().default(0),
    rowsError: integer("rows_error").notNull().default(0),
    errors: jsonb("errors").$type<unknown[]>(),
    actor: text("actor"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    appliedAt: tstz("applied_at"),
  },
  (t) => [
    index("price_imports_vendor_started_idx").on(t.vendorId, t.startedAt.desc()),
    check("price_imports_format_chk", oneOf(t.format, ["csv", "gsheet_csv", "xlsx", "tg_post", "manual"])),
    check("price_imports_status_chk", oneOf(t.status, ["pending", "preview", "applied", "failed"])),
    check("price_imports_rows_chk", sql`${t.rowsMatched} + ${t.rowsUnmatched} + ${t.rowsError} <= ${t.rowsTotal}`),
  ],
);

/** Append-only (only the `excluded` flag with a reason may change). */
export const priceObservations = pricing.table(
  "price_observations",
  {
    id: pk(),
    offerId: uuid("offer_id").references(() => offers.id),
    productId: uuid("product_id").references(() => products.id),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    /** Price in whole sums; for dollar prices it is the conversion at the rate of fx_rate_id. */
    priceSum: sumCol("price_sum").notNull(),
    origAmount: numeric("orig_amount", { precision: 14, scale: 2 }),
    origCurrency: text("orig_currency").$type<"UZS" | "USD">().notNull().default("UZS"),
    fxRateId: uuid("fx_rate_id").references(() => fxRates.id),
    availability: text("availability").$type<(typeof AVAILABILITY)[number]>().notNull(),
    condition: text("condition").$type<(typeof CONDITIONS)[number]>().notNull().default("new"),
    isFromPrice: boolean("is_from_price").notNull().default(false),
    vendorWarrantyMonths: integer("vendor_warranty_months"),
    observedAt: tstz("observed_at").notNull().defaultNow(),
    source: text("source").$type<(typeof OBSERVATION_SOURCES)[number]>().notNull(),
    importId: uuid("import_id").references(() => priceImports.id),
    enteredBy: text("entered_by"),
    excluded: boolean("excluded").notNull().default(false),
    excludeReason: text("exclude_reason").$type<(typeof EXCLUDE_REASONS)[number]>(),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [
    index("price_observations_product_idx").on(t.productId, t.observedAt.desc()),
    index("price_observations_offer_idx").on(t.offerId, t.observedAt.desc()),
    index("price_observations_import_idx").on(t.importId),
    check("price_observations_price_chk", sql`${t.priceSum} > 0`),
    check("price_observations_availability_chk", oneOf(t.availability, AVAILABILITY)),
    check("price_observations_condition_chk", oneOf(t.condition, CONDITIONS)),
    check("price_observations_source_chk", oneOf(t.source, OBSERVATION_SOURCES)),
    check("price_observations_currency_chk", oneOf(t.origCurrency, ["UZS", "USD"])),
    check("price_observations_reason_chk", oneOf(t.excludeReason, EXCLUDE_REASONS)),
    // A flag always travels with its reason, and a reason never exists without the flag.
    check("price_observations_excluded_chk", sql`${t.excluded} = (${t.excludeReason} is not null)`),
    // A dollar price keeps the dollar amount and the CBU rate it was converted at.
    check(
      "price_observations_usd_chk",
      sql`${t.origCurrency} <> 'USD' or (${t.origAmount} is not null and ${t.fxRateId} is not null)`,
    ),
  ],
);

export const marketPrices = pricing.table(
  "market_prices",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    asOf: date("as_of", { mode: "string" }).notNull(),
    /** Null with fewer than three vendors: the customer sees "price is being confirmed, from X". */
    medianSum: sumCol("median_sum"),
    fromSum: sumCol("from_sum"),
    minSum: sumCol("min_sum"),
    maxSum: sumCol("max_sum"),
    offersN: integer("offers_n").notNull().default(0),
    vendorsN: integer("vendors_n").notNull().default(0),
    maxAgeDays: integer("max_age_days"),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    inputIds: uuid("input_ids").array().notNull().default(sql`'{}'::uuid[]`),
    computedAt: tstz("computed_at").notNull().defaultNow(),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [
    unique("market_prices_product_as_of_key").on(t.productId, t.asOf),
    check("market_prices_confidence_chk", oneOf(t.confidence, ["high", "medium", "low"])),
    check("market_prices_order_chk", sql`${t.minSum} is null or ${t.maxSum} is null or ${t.minSum} <= ${t.maxSum}`),
    check("market_prices_median_chk", sql`${t.medianSum} is null or ${t.medianSum} > 0`),
    // Fewer than three vendors: no median and low confidence (ARCHITECTURE 4.5).
    check(
      "market_prices_min_vendors_chk",
      sql`${t.vendorsN} >= 3 or (${t.medianSum} is null and ${t.confidence} = 'low')`,
    ),
    check(
      "market_prices_high_chk",
      sql`${t.confidence} <> 'high' or (${t.vendorsN} >= 5 and ${t.maxAgeDays} is not null and ${t.maxAgeDays} <= 3)`,
    ),
  ],
);
