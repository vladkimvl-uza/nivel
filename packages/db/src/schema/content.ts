import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, localized, oneOf, pk, tstz } from "../repos/columns.ts";
import { adminUsers, consents, files } from "./ops.ts";
import { configurations, orders } from "./sales.ts";

/** PostgreSQL schema "content" (ARCHITECTURE 3.1, 3.3). */
export const content = pgSchema("content");

export const PAGE_KINDS = ["service", "how", "prices", "faq", "warranty"] as const;
export const POLICY_TOPICS = [
  "payment",
  "fee",
  "warranty",
  "returns",
  "timelines",
  "delivery",
  "glossary",
  "privacy_short",
  "response_hours",
] as const;
export const LEGAL_KINDS = [
  "offer",
  "privacy",
  "warranty",
  "returns",
  "consent_pd",
  "consent_ai",
  "consent_marketing",
  "consent_photo",
  "stage_tariff",
  "requisites",
  "ai_how_it_works",
] as const;

export const pages = content.table(
  "pages",
  {
    id: pk(),
    slug: text("slug").notNull(),
    kind: text("kind").$type<(typeof PAGE_KINDS)[number]>().notNull(),
    title: localized("title").notNull(),
    /** Markdown without raw HTML. */
    body: localized("body").notNull(),
    status: text("status").$type<"draft" | "published">().notNull().default("draft"),
    noindex: boolean("noindex").notNull().default(false),
    publishedAt: tstz("published_at"),
    createdAt: createdAt(),
    updatedAt: createdAt("updated_at"),
  },
  (t) => [
    unique("pages_slug_key").on(t.slug),
    check("pages_kind_chk", oneOf(t.kind, PAGE_KINDS)),
    check("pages_status_chk", oneOf(t.status, ["draft", "published"])),
    // Publishing needs the Uzbek text first (DECISIONS R-25).
    check(
      "pages_published_uz_chk",
      sql`${t.status} <> 'published' or (${t.title} ->> 'uz' <> '' and ${t.body} ->> 'uz' <> '' and ${t.publishedAt} is not null)`,
    ),
  ],
);

/** The only source of terms for the bot, the site and `get_policy`. */
export const policyTexts = content.table(
  "policy_texts",
  {
    id: pk(),
    topic: text("topic").$type<(typeof POLICY_TOPICS)[number]>().notNull(),
    body: localized("body").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").$type<"stub" | "approved">().notNull().default("stub"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("policy_texts_topic_version_key").on(t.topic, t.version),
    check("policy_texts_topic_chk", oneOf(t.topic, POLICY_TOPICS)),
    check("policy_texts_status_chk", oneOf(t.status, ["stub", "approved"])),
    check("policy_texts_version_chk", sql`${t.version} > 0`),
  ],
);

/** A published version never changes (trigger); a new text is a new version. */
export const legalDocuments = content.table(
  "legal_documents",
  {
    id: pk(),
    kind: text("kind").$type<(typeof LEGAL_KINDS)[number]>().notNull(),
    version: text("version").notNull(),
    lang: text("lang").$type<"uz" | "ru">().notNull(),
    bodyMd: text("body_md").notNull(),
    status: text("status").$type<"stub" | "lawyer_approved" | "published">().notNull().default("stub"),
    /** SHA-256 of body_md (UTF-8), checked by a trigger when the document is published. */
    textSha256: text("text_sha256").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("legal_documents_kind_version_lang_key").on(t.kind, t.version, t.lang),
    check("legal_documents_kind_chk", oneOf(t.kind, LEGAL_KINDS)),
    check("legal_documents_lang_chk", oneOf(t.lang, ["uz", "ru"])),
    check("legal_documents_status_chk", oneOf(t.status, ["stub", "lawyer_approved", "published"])),
    check("legal_documents_sha_chk", sql`${t.textSha256} ~ '^[0-9a-f]{64}$'`),
    check("legal_documents_published_chk", sql`${t.status} <> 'published' or ${t.effectiveFrom} is not null`),
  ],
);

export const ideaPosts = content.table(
  "idea_posts",
  {
    id: pk(),
    instagramUrl: text("instagram_url").notNull(),
    authorHandle: text("author_handle").notNull(),
    authorProfileUrl: text("author_profile_url"),
    permissionStatus: text("permission_status")
      .$type<"requested" | "granted" | "revoked" | "none">()
      .notNull()
      .default("none"),
    permissionFileId: uuid("permission_file_id").references(() => files.id),
    permissionAt: tstz("permission_at"),
    revokedAt: tstz("revoked_at"),
    /** Revocation + 48 hours. */
    takedownDue: tstz("takedown_due"),
    /** Localized "what is visible" mapped to a product or a price class. */
    breakdown: jsonb("breakdown").$type<unknown[]>().notNull().default([]),
    pcConfigurationId: uuid("pc_configuration_id").references((): AnyPgColumn => configurations.id),
    setupConfigurationId: uuid("setup_configuration_id").references((): AnyPgColumn => configurations.id),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Display only; never stored as the author's content. */
    oembedCache: jsonb("oembed_cache").$type<Record<string, unknown>>(),
    indexable: boolean("indexable").notNull().default(false),
    status: text("status").$type<"draft" | "published" | "hidden" | "takedown">().notNull().default("draft"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("idea_posts_status_idx").on(t.status),
    check("idea_posts_permission_chk", oneOf(t.permissionStatus, ["requested", "granted", "revoked", "none"])),
    check("idea_posts_status_chk", oneOf(t.status, ["draft", "published", "hidden", "takedown"])),
    // Only a post with a granted permission goes live; demo posts are marked and never reach production.
    check(
      "idea_posts_published_chk",
      sql`${t.status} <> 'published' or ${t.permissionStatus} = 'granted' or ${t.isDemo}`,
    ),
    check(
      "idea_posts_revoked_chk",
      sql`${t.permissionStatus} <> 'revoked' or (${t.revokedAt} is not null and ${t.takedownDue} is not null)`,
    ),
  ],
);

export const portfolioItems = content.table(
  "portfolio_items",
  {
    id: pk(),
    kind: text("kind").$type<"own_build" | "concept">().notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    publicationConsentId: uuid("publication_consent_id").references(() => consents.id),
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    caption: localized("caption"),
    label: text("label").$type<"concept" | "visualization">(),
    status: text("status").$type<"draft" | "published">().notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [
    check("portfolio_items_kind_chk", oneOf(t.kind, ["own_build", "concept"])),
    check("portfolio_items_label_chk", oneOf(t.label, ["concept", "visualization"])),
    // A customer's build is shown only with a publication consent; a concept carries its label.
    check(
      "portfolio_items_own_build_chk",
      sql`${t.kind} <> 'own_build' or ${t.status} <> 'published' or (${t.orderId} is not null and ${t.publicationConsentId} is not null)`,
    ),
    check("portfolio_items_concept_chk", sql`${t.kind} <> 'concept' or ${t.label} is not null`),
  ],
);

export const glossary = content.table(
  "glossary",
  {
    id: pk(),
    termRu: text("term_ru").notNull(),
    termUz: text("term_uz").notNull(),
    termUzNewLatin: text("term_uz_new_latin"),
    note: text("note"),
  },
  (t) => [unique("glossary_term_ru_key").on(t.termRu)],
);

export const heroScene = content.table(
  "hero_scene",
  {
    id: pk(),
    posterFileId: uuid("poster_file_id").references(() => files.id),
    video720FileId: uuid("video_720_file_id").references(() => files.id),
    video1080FileId: uuid("video_1080_file_id").references(() => files.id),
    videoVerticalFileId: uuid("video_vertical_file_id").references(() => files.id),
    /** Five frames: file id and a localized caption each. */
    frames: jsonb("frames").$type<{ fileId: string; caption: { uz: string; ru: string } }[]>().notNull().default([]),
    /** The scene is always labelled as a visualization, never presented as a photo. */
    label: text("label").$type<"visualization">().notNull().default("visualization"),
    active: boolean("active").notNull().default(false),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("hero_scene_label_chk", oneOf(t.label, ["visualization"])),
    check(
      "hero_scene_frames_chk",
      sql`jsonb_typeof(${t.frames}) = 'array' and jsonb_array_length(${t.frames}) in (0, 5)`,
    ),
  ],
);
