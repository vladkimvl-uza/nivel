// Repositories of the content schema: pages, policy texts (the single source of terms), legal documents, ideas
// (ARCHITECTURE 3.3, 10.2).
import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ideaPosts, legalDocuments, pages, policyTexts } from "../schema/content.ts";
import { expectUpdated, guarded } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { MS_PER_HOUR } from "./time.ts";

export type PolicyTopic = (typeof policyTexts.$inferSelect)["topic"];
export type LegalKind = (typeof legalDocuments.$inferSelect)["kind"];
export type Lang = "uz" | "ru";

export async function getPublishedPage(db: Executor, slug: string) {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.status, "published")));
  return row ?? null;
}

export async function listPublishedPages(db: Executor, kind?: (typeof pages.$inferSelect)["kind"]) {
  return db
    .select()
    .from(pages)
    .where(and(eq(pages.status, "published"), kind ? eq(pages.kind, kind) : undefined))
    .orderBy(asc(pages.slug));
}

/** Publishing needs the Uzbek title and text (the database refuses a page without them). */
export async function publishPage(db: Executor, slug: string, at: Date = new Date()): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(pages)
      .set({ status: "published", publishedAt: at })
      .where(eq(pages.slug, slug))
      .returning({ id: pages.id }),
  );
  if (rows.length === 0) throw new Error(`page ${slug} not found`);
}

export async function upsertPage(
  db: Executor,
  p: {
    slug: string;
    kind: (typeof pages.$inferSelect)["kind"];
    title: { uz: string; ru: string };
    body: { uz: string; ru: string };
  },
): Promise<void> {
  await guarded(() =>
    db
      .insert(pages)
      .values(p)
      .onConflictDoUpdate({ target: pages.slug, set: { kind: p.kind, title: p.title, body: p.body } }),
  );
}

/** The text of a policy topic: the newest approved version, else the newest stub (marked as such). */
export async function getPolicy(db: Executor, topic: PolicyTopic) {
  const [approved] = await db
    .select()
    .from(policyTexts)
    .where(and(eq(policyTexts.topic, topic), eq(policyTexts.status, "approved")))
    .orderBy(desc(policyTexts.version))
    .limit(1);
  if (approved) return approved;
  const [newest] = await db
    .select()
    .from(policyTexts)
    .where(eq(policyTexts.topic, topic))
    .orderBy(desc(policyTexts.version))
    .limit(1);
  return newest ?? null;
}

export async function addPolicyVersion(
  db: Executor,
  topic: PolicyTopic,
  body: { uz: string; ru: string },
  status: "stub" | "approved" = "stub",
): Promise<number> {
  const { rows } = await db.execute<{ v: number }>(
    sql`select coalesce(max(version), 0) + 1 as v from content.policy_texts where topic = ${topic}`,
  );
  const version = Number(rows[0]?.v ?? 1);
  await guarded(() => db.insert(policyTexts).values({ topic, body, version, status }));
  return version;
}

// ---- legal documents ----------------------------------------------------------------------------------------------
/** SHA-256 of the text as the database computes it for the check at publication (UTF-8, lower-case hex). */
export function textSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function createLegalDocument(
  db: Executor,
  d: {
    kind: LegalKind;
    version: string;
    lang: Lang;
    bodyMd: string;
    effectiveFrom?: string;
    status?: "stub" | "lawyer_approved";
  },
): Promise<string> {
  const [row] = await guarded(() =>
    db
      .insert(legalDocuments)
      .values({
        kind: d.kind,
        version: d.version,
        lang: d.lang,
        bodyMd: d.bodyMd,
        textSha256: textSha256(d.bodyMd),
        effectiveFrom: d.effectiveFrom ?? null,
        status: d.status ?? "stub",
      })
      .returning({ id: legalDocuments.id }),
  );
  if (!row) throw new Error("document was not written");
  return row.id;
}

/** Publishes a version: from now on it never changes, consents refer to its hash. */
export async function publishLegalDocument(db: Executor, id: string, effectiveFrom: string): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(legalDocuments)
      .set({ status: "published", effectiveFrom })
      .where(eq(legalDocuments.id, id))
      .returning({ id: legalDocuments.id }),
  );
  expectUpdated(rows, "legal document", id);
}

/** The newest published version of a document in a language, or null (the offer is then still a stub). */
export async function getPublishedLegalDocument(db: Executor, kind: LegalKind, lang: Lang) {
  const [row] = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.lang, lang), eq(legalDocuments.status, "published")))
    .orderBy(desc(legalDocuments.effectiveFrom), desc(legalDocuments.createdAt))
    .limit(1);
  return row ?? null;
}

// ---- ideas ------------------------------------------------------------------------------------------------------
export async function listPublishedIdeas(db: Executor, o: { includeDemo?: boolean } = {}) {
  return db
    .select()
    .from(ideaPosts)
    .where(and(eq(ideaPosts.status, "published"), o.includeDemo ? undefined : eq(ideaPosts.isDemo, false)))
    .orderBy(desc(ideaPosts.createdAt));
}

/** The author withdrew the permission: the post is hidden now and must be gone within 48 hours. */
export async function revokeIdeaPermission(db: Executor, id: string, now: Date = new Date()): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(ideaPosts)
      .set({
        permissionStatus: "revoked",
        revokedAt: now,
        takedownDue: new Date(now.getTime() + 48 * MS_PER_HOUR),
        status: "takedown",
      })
      .where(eq(ideaPosts.id, id))
      .returning({ id: ideaPosts.id }),
  );
  expectUpdated(rows, "idea post", id);
}
