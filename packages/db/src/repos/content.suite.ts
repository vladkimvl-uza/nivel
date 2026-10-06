import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import {
  addPolicyVersion,
  createLegalDocument,
  getPolicy,
  getPublishedLegalDocument,
  getPublishedPage,
  listPublishedIdeas,
  listPublishedPages,
  publishLegalDocument,
  publishPage,
  revokeIdeaPermission,
  textSha256,
  upsertPage,
} from "./content.ts";
import { openDb, uniq } from "./testkit.ts";

let db: Db;
beforeAll(() => {
  db = openDb("ADMIN");
});
afterAll(async () => {
  await db.$client.end();
});

describe("pages", () => {
  it("shows a page only after it is published, and publishing needs the Uzbek text", async () => {
    const slug = `how-${uniq()}`;
    await upsertPage(db, {
      slug,
      kind: "how",
      title: { uz: "Qanday ishlaydi", ru: "Как это работает" },
      body: { uz: "Matn", ru: "Текст" },
    });
    expect(await getPublishedPage(db, slug)).toBeNull();
    await publishPage(db, slug, new Date("2026-10-06T10:00:00Z"));
    expect((await getPublishedPage(db, slug))?.title.ru).toBe("Как это работает");
    expect((await listPublishedPages(db, "how")).map((p) => p.slug)).toContain(slug);
    expect((await listPublishedPages(db, "faq")).map((p) => p.slug)).not.toContain(slug);
    await expect(publishPage(db, "no-such-page")).rejects.toThrow(/not found/);

    const ruOnly = `ru-${uniq()}`;
    await upsertPage(db, {
      slug: ruOnly,
      kind: "faq",
      title: { uz: "", ru: "Вопросы" },
      body: { uz: "", ru: "Текст" },
    });
    await expect(publishPage(db, ruOnly)).rejects.toMatchObject({
      code: "check_violation",
      constraint: "pages_published_uz_chk",
    });
    // Updating a page keeps its slug and changes its text.
    await upsertPage(db, { slug, kind: "how", title: { uz: "Yangi", ru: "Новый" }, body: { uz: "Matn", ru: "Текст" } });
    expect((await getPublishedPage(db, slug))?.title.uz).toBe("Yangi");
  });

  it("moves updated_at forward on every change (the touch trigger of the table)", async () => {
    const slug = `touch-${uniq()}`;
    await upsertPage(db, { slug, kind: "faq", title: { uz: "A", ru: "А" }, body: { uz: "B", ru: "Б" } });
    const read = async () =>
      (await db.$client.query<{ at: Date }>("select updated_at as at from content.pages where slug = $1", [slug]))
        .rows[0]?.at;
    const first = await read();
    await db.$client.query("select pg_sleep(0.05)");
    await upsertPage(db, { slug, kind: "faq", title: { uz: "A2", ru: "А2" }, body: { uz: "B", ru: "Б" } });
    const second = await read();
    expect(first && second && second.getTime() > first.getTime()).toBe(true);
  });
});

describe("policy texts", () => {
  it("serves the newest approved version, falls back to the newest stub, and numbers versions", async () => {
    expect(await getPolicy(db, "returns")).toBeNull();
    expect(await addPolicyVersion(db, "returns", { uz: "Qaytarish (qoralama)", ru: "Возврат (черновик)" })).toBe(1);
    expect((await getPolicy(db, "returns"))?.status).toBe("stub");
    expect(await addPolicyVersion(db, "returns", { uz: "Qaytarish 2", ru: "Возврат 2" }, "approved")).toBe(2);
    expect(await addPolicyVersion(db, "returns", { uz: "Qaytarish 3 (qoralama)", ru: "Возврат 3 (черновик)" })).toBe(3);
    const now = await getPolicy(db, "returns");
    expect(now).toMatchObject({ version: 2, status: "approved" });
    expect(now?.body.ru).toBe("Возврат 2");
  });
});

describe("legal documents", () => {
  it("keeps the hash of the text, publishes a version and then never changes it", async () => {
    const text = "# Oferta\n\nShartlar...";
    expect(textSha256(text)).toMatch(/^[0-9a-f]{64}$/);
    expect(await getPublishedLegalDocument(db, "offer", "uz")).toBeNull();
    const v1 = await createLegalDocument(db, { kind: "offer", version: `v${uniq()}`, lang: "uz", bodyMd: text });
    expect(await getPublishedLegalDocument(db, "offer", "uz")).toBeNull();
    await publishLegalDocument(db, v1, "2026-11-01");
    const live = await getPublishedLegalDocument(db, "offer", "uz");
    expect(live).toMatchObject({ id: v1, status: "published", textSha256: textSha256(text) });
    await expect(publishLegalDocument(db, v1, "2026-12-01")).rejects.toMatchObject({ code: "immutable" });
    // A new version takes over when it is published; the old one stays as it was.
    const v2 = await createLegalDocument(db, {
      kind: "offer",
      version: `v${uniq()}`,
      lang: "uz",
      bodyMd: `${text}\n\nYangi band.`,
    });
    await publishLegalDocument(db, v2, "2026-12-01");
    expect((await getPublishedLegalDocument(db, "offer", "uz"))?.id).toBe(v2);
    expect(await getPublishedLegalDocument(db, "offer", "ru")).toBeNull();
  });

  it("refuses a stored hash that does not match the text at publication", async () => {
    const id = await createLegalDocument(db, {
      kind: "privacy",
      version: `v${uniq()}`,
      lang: "ru",
      bodyMd: "Политика",
    });
    await db.$client.query("update content.legal_documents set body_md = 'Другая политика' where id = $1", [id]);
    await expect(publishLegalDocument(db, id, "2026-11-01")).rejects.toMatchObject({ code: "text_hash_mismatch" });
  });
});

describe("ideas", () => {
  async function idea(isDemo: boolean, status: "published" | "draft", granted: boolean) {
    const { rows } = await db.$client.query<{ id: string }>(
      `insert into content.idea_posts (instagram_url, author_handle, permission_status, status, is_demo)
       values ($1, '@a', $2, $3, $4) returning id`,
      [`https://example.test/p/${uniq()}`, granted ? "granted" : "none", status, isDemo],
    );
    return rows[0]?.id as string;
  }

  it("lists published ideas without the demo ones unless asked", async () => {
    const real = await idea(false, "published", true);
    const demo = await idea(true, "published", false);
    await idea(false, "draft", true);
    const live = (await listPublishedIdeas(db)).map((i) => i.id);
    expect(live).toContain(real);
    expect(live).not.toContain(demo);
    expect((await listPublishedIdeas(db, { includeDemo: true })).map((i) => i.id)).toContain(demo);
  });

  it("takes a post down within 48 hours when the author withdraws the permission", async () => {
    const id = await idea(false, "published", true);
    const now = new Date("2026-10-06T10:00:00Z");
    await revokeIdeaPermission(db, id, now);
    const { rows } = await db.$client.query(
      "select permission_status, status, takedown_due from content.idea_posts where id = $1",
      [id],
    );
    expect(rows[0]).toMatchObject({ permission_status: "revoked", status: "takedown" });
    expect(new Date(rows[0]?.takedown_due).toISOString()).toBe("2026-10-08T10:00:00.000Z");
    expect((await listPublishedIdeas(db)).map((i) => i.id)).not.toContain(id);
  });
});
