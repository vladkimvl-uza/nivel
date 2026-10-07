import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
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
import { createdAt, oneOf, pk, sumCol, tstz } from "../repos/columns.ts";
import { legalDocuments } from "./content.ts";
import { customers, orders } from "./sales.ts";

/** PostgreSQL schema "ops" (ARCHITECTURE 3.1, 3.3). */
export const ops = pgSchema("ops");

export const ADMIN_ROLES = ["owner", "assistant", "translator", "accountant"] as const;
export const CONSENT_KINDS = [
  "pd_processing",
  "ai_transfer_us",
  "marketing",
  "photo_publication",
  "supplier_data_transfer",
  "age_18",
  "analytics_cookies",
  "limit_overrun",
  "non_returnable",
  "replacement",
  "no_receipt_purchase",
  "third_party_payer",
] as const;
export const RETENTION_CLASSES = ["lead_12m", "order_warranty_plus_3y", "tax_5y", "ai_90d", "media"] as const;
/**
 * The kinds of files the services register (ops.files.kind). The list is open on purpose: the database checks only the
 * form of the name (`files_kind_chk`), so that the worker can add a document kind without a migration; the kinds the
 * scenarios rely on are named here. `act_photo` is the photo of a paper act, the evidence of acts.sign by `paper_photo`.
 */
export const FILE_KINDS = [
  "act_photo",
  "receipt_photo",
  "third_party_statement",
  "quote_pdf",
  "report_pdf",
  "act_pdf",
  "passport_pdf",
  "dsr_export",
] as const;
/** The largest stored size (pg_column_size, bytes) of the evidence of a consent. */
export const CONSENT_EVIDENCE_BYTES = 4096;

export const files = ops.table(
  "files",
  {
    id: pk(),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    kind: text("kind").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    containsPd: boolean("contains_pd").notNull().default(false),
    retentionClass: text("retention_class").$type<(typeof RETENTION_CLASSES)[number]>().notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("files_storage_key_key").on(t.storageKey),
    index("files_sha256_idx").on(t.sha256),
    check("files_sha256_chk", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("files_bytes_chk", sql`${t.bytes} >= 0`),
    check("files_retention_chk", oneOf(t.retentionClass, RETENTION_CLASSES)),
    check("files_kind_chk", sql`${t.kind} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    // The key is a relative path under the directory of the files, one segment at a time: it never starts with a slash or
    // a dot, has no empty or dotted segment, no backslash and no control character. The purge hands the keys to the worker
    // to remove from the disk, so a key that could climb out of the directory would reach any file the worker can write.
    check(
      "files_storage_key_chk",
      sql`${t.storageKey} ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$' and char_length(${t.storageKey}) <= 300`,
    ),
    // Personal data never sits in a public file.
    check("files_public_no_pd_chk", sql`not (${t.isPublic} and ${t.containsPd})`),
  ],
);

export const adminUsers = ops.table(
  "admin_users",
  {
    id: pk(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecretEnc: text("totp_secret_enc"),
    role: text("role").$type<(typeof ADMIN_ROLES)[number]>().notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    active: boolean("active").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("admin_users_email_key").on(sql`lower(${t.email})`),
    // One account per Telegram id: sales.apply_transition() trusts the bot as the owner or the assistant only by it.
    uniqueIndex("admin_users_telegram_user_id_key").on(t.telegramUserId).where(sql`${t.telegramUserId} is not null`),
    check("admin_users_role_chk", oneOf(t.role, ADMIN_ROLES)),
  ],
);

export const adminSessions = ops.table(
  "admin_sessions",
  {
    tokenSha256: text("token_sha256").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
    ipHash: text("ip_hash"),
    ua: text("ua"),
  },
  (t) => [
    index("admin_sessions_user_idx").on(t.userId),
    index("admin_sessions_expires_idx").on(t.expiresAt),
    check("admin_sessions_token_chk", sql`${t.tokenSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const settings = ops.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  /** Bumped by a trigger on every change. */
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by"),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const outbox = ops.table(
  "outbox",
  {
    id: pk(),
    kind: text("kind").$type<"telegram_message" | "job">().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Repeated writes with the same key are ignored (idempotent dispatch). */
    dedupeKey: text("dedupe_key"),
    priority: integer("priority").notNull().default(0),
    status: text("status").$type<"pending" | "sent" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sendAfter: tstz("send_after").notNull().defaultNow(),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("outbox_dedupe_key_idx").on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("outbox_due_idx").on(t.status, t.sendAfter, t.priority),
    check("outbox_kind_chk", oneOf(t.kind, ["telegram_message", "job"])),
    check("outbox_status_chk", oneOf(t.status, ["pending", "sent", "failed"])),
  ],
);

export const consents = ops.table(
  "consents",
  {
    id: pk(),
    customerId: uuid("customer_id").references(() => customers.id),
    /** Hash of a Telegram or session reference for people who are not customers yet. */
    subjectRefHash: text("subject_ref_hash"),
    orderId: uuid("order_id").references(() => orders.id),
    kind: text("kind").$type<(typeof CONSENT_KINDS)[number]>().notNull(),
    /** Withdrawal is a new row with granted = false (the journal is append-only). */
    granted: boolean("granted").notNull(),
    documentId: uuid("document_id").references(() => legalDocuments.id),
    textSha256: text("text_sha256"),
    lang: text("lang").$type<"uz" | "ru">(),
    channel: text("channel"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    index("consents_order_kind_idx").on(t.orderId, t.kind, t.at),
    index("consents_customer_idx").on(t.customerId, t.at),
    check("consents_kind_chk", oneOf(t.kind, CONSENT_KINDS)),
    // The journal is for good and the site and the bot write into it: what stays in it stays small.
    check(
      "consents_evidence_size_chk",
      sql`${t.evidence} is null or pg_column_size(${t.evidence}) <= ${sql.raw(String(CONSENT_EVIDENCE_BYTES))}`,
    ),
    check("consents_subject_chk", sql`${t.customerId} is not null or ${t.subjectRefHash} is not null`),
    // Order-level consents always name the order.
    check(
      "consents_order_scope_chk",
      sql`${t.kind} not in ('limit_overrun', 'non_returnable', 'replacement', 'no_receipt_purchase', 'third_party_payer') or ${t.orderId} is not null`,
    ),
  ],
);

export const dsrRequests = ops.table(
  "dsr_requests",
  {
    id: pk(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    kind: text("kind").$type<"copy" | "rectify" | "erase">().notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    /** Receipt + 30 days (the law's deadline). */
    due: tstz("due").notNull().default(sql`now() + interval '30 days'`),
    status: text("status").$type<"open" | "in_progress" | "done" | "rejected">().notNull().default("open"),
    resultFileId: uuid("result_file_id").references(() => files.id),
  },
  (t) => [
    index("dsr_requests_status_due_idx").on(t.status, t.due),
    check("dsr_requests_kind_chk", oneOf(t.kind, ["copy", "rectify", "erase"])),
    check("dsr_requests_status_chk", oneOf(t.status, ["open", "in_progress", "done", "rejected"])),
  ],
);

export const auditLog = ops.table(
  "audit_log",
  {
    id: pk(),
    at: tstz("at").notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    ipHash: text("ip_hash"),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId, t.at), index("audit_log_at_idx").on(t.at)],
);

export const appErrors = ops.table(
  "app_errors",
  {
    id: pk(),
    at: tstz("at").notNull().defaultNow(),
    app: text("app").notNull(),
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    /** No personal data in stacks. */
    stack: text("stack"),
    count: integer("count").notNull().default(1),
    lastAt: tstz("last_at").notNull().defaultNow(),
  },
  (t) => [unique("app_errors_fingerprint_key").on(t.app, t.fingerprint), index("app_errors_last_idx").on(t.lastAt)],
);

export const thresholdSnapshots = ops.table(
  "threshold_snapshots",
  {
    id: pk(),
    year: integer("year").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    dealsSum: sumCol("deals_sum").notNull(),
    committedSum: sumCol("committed_sum").notNull(),
    limitSum: sumCol("limit_sum").notNull(),
    planCapSum: sumCol("plan_cap_sum"),
    shareBp: integer("share_bp").notNull(),
  },
  (t) => [
    unique("threshold_snapshots_year_as_of_key").on(t.year, t.asOf),
    check("threshold_snapshots_share_chk", sql`${t.shareBp} >= 0`),
  ],
);

/** Per-year counters for public numbers L-2026-0001, NV-2026-0001, G-2026-0001 (function ops.next_number). */
export const numberCounters = ops.table(
  "number_counters",
  {
    kind: text("kind").$type<"L" | "NV" | "G">().notNull(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.year] }),
    check("number_counters_kind_chk", oneOf(t.kind, ["L", "NV", "G"])),
  ],
);
