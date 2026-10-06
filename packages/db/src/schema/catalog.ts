import type { CategoryCode, FeeGroup } from "@nivel/domain/catalog";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { createdAt, localized, oneOf, pk, tstz } from "../repos/columns.ts";
import { adminUsers, files } from "./ops.ts";

/** PostgreSQL schema "catalog" (ARCHITECTURE 3.1, 3.3). */
export const catalog = pgSchema("catalog");

export const CATEGORY_GROUPS = ["pc", "setup", "service"] as const;
export const FEE_GROUPS = ["pc", "mount", "outside_scale"] as const;
export const PRODUCT_STATUSES = ["draft", "verified", "retired"] as const;
export const TASKS = ["gaming", "streaming", "design3d", "programming", "office"] as const;
export const TIERS = ["T1", "T2", "T3", "T4"] as const;
export const LADDER_CODES = ["gpu", "cpu_am5", "cpu_lga1700", "ram", "ssd"] as const;

export const categories = catalog.table(
  "categories",
  {
    id: pk(),
    code: text("code").$type<CategoryCode>().notNull(),
    group: text("category_group").$type<(typeof CATEGORY_GROUPS)[number]>().notNull(),
    name: localized("name").notNull(),
    feeGroupDefault: text("fee_group_default").$type<FeeGroup>().notNull(),
    freshnessDays: integer("freshness_days").notNull(),
    returnableDefault: boolean("returnable_default").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    unique("categories_code_key").on(t.code),
    check("categories_group_chk", oneOf(t.group, CATEGORY_GROUPS)),
    check("categories_fee_group_chk", oneOf(t.feeGroupDefault, FEE_GROUPS)),
    check("categories_freshness_chk", sql`${t.freshnessDays} > 0`),
  ],
);

export const ladders = catalog.table(
  "ladders",
  {
    id: pk(),
    code: text("code").$type<(typeof LADDER_CODES)[number]>().notNull(),
    /** Ordered price class ids, ascending performance. */
    steps: uuid("steps").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [unique("ladders_code_key").on(t.code), check("ladders_code_chk", oneOf(t.code, LADDER_CODES))],
);

export const priceClasses = catalog.table(
  "price_classes",
  {
    id: pk(),
    categoryCode: text("category_code")
      .$type<CategoryCode>()
      .notNull()
      .references(() => categories.code),
    /** Stable key, e.g. `gpu.rtx5070`. */
    key: text("key").notNull(),
    name: localized("name").notNull(),
    ladderCode: text("ladder_code")
      .$type<(typeof LADDER_CODES)[number]>()
      .references(() => ladders.code),
    step: integer("step"),
    /** Performance class: an estimate, shown as such. */
    perfClass: localized("perf_class"),
    manualOnly: boolean("manual_only").notNull().default(false),
  },
  (t) => [
    unique("price_classes_key_key").on(t.key),
    index("price_classes_ladder_step_idx").on(t.ladderCode, t.step),
    check("price_classes_ladder_step_chk", sql`(${t.ladderCode} is null) = (${t.step} is null)`),
  ],
);

export const products = catalog.table(
  "products",
  {
    id: pk(),
    slug: text("slug").notNull(),
    categoryCode: text("category_code")
      .$type<CategoryCode>()
      .notNull()
      .references(() => categories.code),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    mpn: text("mpn"),
    ean: text("ean"),
    priceClassId: uuid("price_class_id").references(() => priceClasses.id),
    ladderStep: integer("ladder_step"),
    colorBody: text("color_body").$type<"black" | "white" | "gray" | "other">().notNull().default("other"),
    lighting: text("lighting").$type<"none" | "rgb" | "argb">().notNull().default("none"),
    noiseDba: integer("noise_dba"),
    powerPeakW: integer("power_peak_w"),
    powerTypicalW: integer("power_typical_w"),
    mfrWarrantyMonths: integer("mfr_warranty_months"),
    officialImport: text("official_import").$type<"yes" | "no" | "unknown">().notNull().default("unknown"),
    mfrUrl: text("mfr_url"),
    mfrCheckedAt: tstz("mfr_checked_at"),
    status: text("status").$type<(typeof PRODUCT_STATUSES)[number]>().notNull().default("draft"),
    /** Characteristics by category (ARCHITECTURE 4.3); unknown value is JSON null, never a guess. */
    specs: jsonb("specs").$type<Record<string, unknown>>().notNull().default({}),
    dimsMm: jsonb("dims_mm").$type<{ w: number; d: number; h: number }>(),
    /** Overrides categories.fee_group_default when set. */
    feeGroup: text("fee_group").$type<FeeGroup>(),
    /** Overrides categories.returnable_default when set. */
    returnable: boolean("returnable"),
    manualOnly: boolean("manual_only").notNull().default(false),
    imageFileId: uuid("image_file_id").references(() => files.id),
    description: localized("description"),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    verifiedBy: uuid("verified_by").references(() => adminUsers.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: createdAt("updated_at"),
    /** STORED copies of the keys the compatibility rules filter on (B-tree indexed). */
    specSocket: text("spec_socket").generatedAlwaysAs(sql`specs ->> 'socket'`),
    specRamType: text("spec_ram_type").generatedAlwaysAs(
      sql`case when category_code = 'ram' then specs ->> 'type' else specs ->> 'ramType' end`,
    ),
    specFormFactor: text("spec_form_factor").generatedAlwaysAs(sql`specs ->> 'formFactor'`),
  },
  (t) => [
    uniqueIndex("products_slug_key").on(t.slug),
    unique("products_brand_mpn_key").on(t.brand, t.mpn),
    index("products_category_status_idx").on(t.categoryCode, t.status),
    index("products_price_class_idx").on(t.priceClassId),
    index("products_spec_socket_idx").on(t.specSocket),
    index("products_spec_ram_type_idx").on(t.specRamType),
    index("products_spec_form_factor_idx").on(t.specFormFactor),
    check("products_status_chk", oneOf(t.status, PRODUCT_STATUSES)),
    check("products_color_chk", oneOf(t.colorBody, ["black", "white", "gray", "other"])),
    check("products_lighting_chk", oneOf(t.lighting, ["none", "rgb", "argb"])),
    check("products_official_import_chk", oneOf(t.officialImport, ["yes", "no", "unknown"])),
    check("products_fee_group_chk", oneOf(t.feeGroup, FEE_GROUPS)),
    check("products_specs_object_chk", sql`jsonb_typeof(${t.specs}) = 'object'`),
  ],
);

export const analogs = catalog.table(
  "analogs",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    analogProductId: uuid("analog_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.analogProductId] }),
    check("analogs_not_self_chk", sql`${t.productId} <> ${t.analogProductId}`),
  ],
);

export const perfFacts = catalog.table(
  "perf_facts",
  {
    id: pk(),
    priceClassId: uuid("price_class_id")
      .notNull()
      .references(() => priceClasses.id, { onDelete: "cascade" }),
    task: text("task").$type<(typeof TASKS)[number]>().notNull(),
    metric: text("metric").notNull(),
    value: text("value").notNull(),
    conditions: text("conditions"),
    /** A fact without a source is never published (ARCHITECTURE 3.3). */
    source: text("source"),
    url: text("url"),
    fetchedAt: tstz("fetched_at"),
    enteredBy: uuid("entered_by").references(() => adminUsers.id),
    published: boolean("published").notNull().default(false),
  },
  (t) => [
    index("perf_facts_class_task_idx").on(t.priceClassId, t.task),
    check("perf_facts_task_chk", oneOf(t.task, TASKS)),
    check(
      "perf_facts_published_source_chk",
      sql`not ${t.published} or (${t.source} is not null and ${t.fetchedAt} is not null)`,
    ),
  ],
);

export const ruleSets = catalog.table(
  "rule_sets",
  {
    id: pk(),
    version: integer("version").notNull(),
    status: text("status").$type<"draft" | "published">().notNull().default("draft"),
    /** RuleSet, CompatSettings, SelectionSettings (ARCHITECTURE 4.4, 4.11). */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    goldenRun: jsonb("golden_run").$type<Record<string, unknown>>(),
    publishedAt: tstz("published_at"),
    publishedBy: uuid("published_by").references(() => adminUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("rule_sets_version_key").on(t.version),
    uniqueIndex("rule_sets_one_published_idx").on(t.status).where(sql`${t.status} = 'published'`),
    check("rule_sets_status_chk", oneOf(t.status, ["draft", "published"])),
    check("rule_sets_published_chk", sql`${t.status} <> 'published' or ${t.publishedAt} is not null`),
  ],
);

export const baseBuilds = catalog.table(
  "base_builds",
  {
    id: pk(),
    task: text("task").$type<(typeof TASKS)[number]>().notNull(),
    tier: text("tier").$type<(typeof TIERS)[number]>().notNull(),
    style: text("style").$type<"A" | "B">().notNull(),
    variant: text("variant").$type<"base" | "plus">().notNull().default("base"),
    status: text("status").$type<"offered" | "not_offered">().notNull().default("offered"),
    redirectTask: text("redirect_task").$type<(typeof TASKS)[number]>(),
    explain: localized("explain"),
    isShowcase: boolean("is_showcase").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [
    unique("base_builds_cell_key").on(t.task, t.tier, t.style, t.variant),
    check("base_builds_task_chk", oneOf(t.task, TASKS)),
    check("base_builds_tier_chk", oneOf(t.tier, TIERS)),
    check("base_builds_style_chk", oneOf(t.style, ["A", "B"])),
    check("base_builds_variant_chk", oneOf(t.variant, ["base", "plus"])),
    check("base_builds_status_chk", oneOf(t.status, ["offered", "not_offered"])),
    // "Not offered" always points the customer to another task (ARCHITECTURE 4.11).
    check("base_builds_redirect_chk", sql`${t.status} <> 'not_offered' or ${t.redirectTask} is not null`),
  ],
);

export const baseBuildItems = catalog.table(
  "base_build_items",
  {
    id: pk(),
    baseBuildId: uuid("base_build_id")
      .notNull()
      .references(() => baseBuilds.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    slot: text("slot").$type<CategoryCode>().notNull(),
    priceClassId: uuid("price_class_id").references(() => priceClasses.id),
    productId: uuid("product_id").references(() => products.id),
    qty: integer("qty").notNull().default(1),
    role: text("role").$type<"primary" | "secondary" | "support">().notNull().default("support"),
  },
  (t) => [
    index("base_build_items_build_idx").on(t.baseBuildId),
    check("base_build_items_one_ref_chk", sql`(${t.priceClassId} is null) <> (${t.productId} is null)`),
    check("base_build_items_qty_chk", sql`${t.qty} > 0`),
    check("base_build_items_role_chk", oneOf(t.role, ["primary", "secondary", "support"])),
  ],
);
