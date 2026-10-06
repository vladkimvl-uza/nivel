// Integration: the catalog resource on a real database, through the role nivel_admin: the GPU row from a file becomes
// a position, an edit by form changes the specification, the rules of the database come back as text.
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAuditSink } from "../../auth/audit.ts";
import type { SessionUser } from "../../auth/service.ts";
import { formDataSource } from "../form.ts";
import { type CatalogValue, createCatalogResource } from "./resource.ts";
import { createPgCatalogStore } from "./store.pg.ts";

let db: Db;
let owner: SessionUser;
let resource: ReturnType<typeof createCatalogResource>;

beforeAll(async () => {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set by the harness");
  db = createDb(url, { max: 4 });
  const id = randomUUID();
  await db.$client.query(
    "insert into ops.admin_users (id, email, password_hash, role) values ($1, 'cat-owner@nivel.test', 'x', 'owner')",
    [id],
  );
  // The template database holds the schema only; the categories come with the seed in a real database.
  await db.$client.query(
    `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
     values ('gpu', 'pc', '{"uz":"Videokarta","ru":"Видеокарта"}', 'pc', 3, true, 5),
            ('ram', 'pc', '{"uz":"Operativ xotira","ru":"Оперативная память"}', 'pc', 7, true, 3)
     on conflict (code) do nothing`,
  );
  owner = { id, email: "cat-owner@nivel.test", role: "owner", telegramUserId: null, sessionExpiresAt: new Date(0) };
  resource = createCatalogResource(createPgCatalogStore(db), createPgAuditSink(db));
});

afterAll(async () => {
  await db.$client.end();
});

const GPU_CSV = [
  "category,brand,model,mpn,color,lighting,spec.chip,spec.vramGb,spec.lengthMm,spec.heightMm,spec.slots,spec.power.0.conn,spec.power.0.count,spec.adapterInBox,spec.tgpW,spec.hwEncoders",
  "gpu,ASUS,Dual GeForce RTX 5070 OC,DUAL-RTX5070-O12G,black,rgb,GeForce RTX 5070,12,304,126,2.5,12V-2x6,1,да,250,NVENC|AV1",
].join("\n");

async function auditFor(id: string) {
  const { rows } = await db.$client.query<{ action: string; actor: string }>(
    "select action, actor from ops.audit_log where entity = 'catalog.products' and entity_id = $1 order by at, id",
    [id],
  );
  return rows;
}

describe("catalog import and edit on PostgreSQL", () => {
  it("a GPU row from a CSV file becomes a draft position with its specification, and is journaled", async () => {
    const applied = await resource.importApply(owner, GPU_CSV);
    expect(applied).toMatchObject({ ok: true, applied: { created: 1, updated: 0 }, failed: [] });

    const list = await resource.list(owner, { category: "gpu" });
    const row = list.rows.find((r) => (r.value as CatalogValue).mpn === "DUAL-RTX5070-O12G");
    expect(row).toBeTruthy();
    if (!row) return;
    expect(row.value).toMatchObject({
      category: "gpu",
      brand: "ASUS",
      status: "draft",
      isDemo: false,
      spec: {
        chip: "GeForce RTX 5070",
        vramGb: 12,
        slots: 2.5,
        power: [{ conn: "12V-2x6", count: 1 }],
        hwEncoders: ["NVENC", "AV1"],
        vendorRecommendedPsuW: null,
      },
    });
    const { rows } = await db.$client.query<{ slug: string; created_by: string }>(
      "select slug, created_by from catalog.products where id = $1",
      [row.id],
    );
    expect(rows[0]?.slug).toBe("asus-dual-geforce-rtx-5070-oc-dual-rtx5070-o12g");
    expect(rows[0]?.created_by).toBe(owner.id);
    expect((await auditFor(row.id)).map((a) => a.action)).toEqual(["catalog.create"]);
  });

  it("the same file again updates the position instead of making a twin", async () => {
    const before = await db.$client.query(
      "select count(*)::int as n from catalog.products where mpn = 'DUAL-RTX5070-O12G'",
    );
    const again = await resource.importApply(owner, GPU_CSV.replace(",12,304", ",16,304"));
    expect(again).toMatchObject({ ok: true, applied: { created: 0, updated: 1 } });
    const after = await db.$client.query(
      "select count(*)::int as n, max((specs->>'vramGb')::int) as vram from catalog.products where mpn = 'DUAL-RTX5070-O12G'",
    );
    expect(before.rows[0].n).toBe(1);
    expect(after.rows[0]).toEqual({ n: 1, vram: 16 });
  });

  it("an edit through the form changes the specification, journals before and after, and keeps the status", async () => {
    const found = await db.$client.query<{ id: string }>(
      "select id from catalog.products where mpn = 'DUAL-RTX5070-O12G'",
    );
    const id = found.rows[0]?.id ?? "";
    const stored = await resource.get(owner, id);
    expect(stored?.value.spec.vramGb).toBe(16);

    const data = new FormData();
    for (const [k, v] of Object.entries({
      category: "gpu",
      brand: "ASUS",
      model: "Dual GeForce RTX 5070 OC",
      mpn: "DUAL-RTX5070-O12G",
      color: "black",
      lighting: "rgb",
      manualOnly: "false",
      "spec.chip": "GeForce RTX 5070",
      "spec.vramGb": "12",
      "spec.lengthMm": "304",
      "spec.power.__count": "1",
      "spec.power.0.conn": "12V-2x6",
      "spec.power.0.count": "1",
      "spec.hwEncoders": "NVENC",
    })) {
      data.set(k, v);
    }
    const saved = await resource.save(owner, id, formDataSource(data));
    expect(saved.ok).toBe(true);
    const next = await resource.get(owner, id);
    expect(next?.value.spec.vramGb).toBe(12);
    expect(next?.value.spec.hwEncoders).toEqual(["NVENC"]);
    expect(next?.value.status).toBe("draft");
    const audits = await db.$client.query<{
      action: string;
      before: { spec: { vramGb: number } };
      after: { spec: { vramGb: number } };
    }>(
      "select action, before, after from ops.audit_log where entity = 'catalog.products' and entity_id = $1 and action = 'catalog.update' order by at, id",
      [id],
    );
    // The first update is the re-import of the file (12 -> 16), the second is this edit (16 -> 12).
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows[1]?.before.spec.vramGb).toBe(16);
    expect(audits.rows[1]?.after.spec.vramGb).toBe(12);
  });

  it("refuses to verify a position with missing key characteristics and names them in Russian", async () => {
    const found = await db.$client.query<{ id: string }>(
      "select id from catalog.products where mpn = 'DUAL-RTX5070-O12G'",
    );
    const id = found.rows[0]?.id ?? "";
    const r = await resource.setStatus(owner, id, "verified");
    // GPU needs lengthMm, power and tgpW: tgpW is not known in the stored position.
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors[""]).toMatch(/Нельзя подтвердить: не заполнены ключевые характеристики — .*TGP/);
    const still = await resource.get(owner, id);
    expect(still?.value.status).toBe("draft");
  });

  it("verifies a complete position and records who did it", async () => {
    const csv = GPU_CSV.replace("DUAL-RTX5070-O12G", "TUF-5070-COMPLETE").replace("Dual GeForce", "TUF GeForce");
    await resource.importApply(owner, csv);
    const found = await db.$client.query<{ id: string }>(
      "select id from catalog.products where mpn = 'TUF-5070-COMPLETE'",
    );
    const id = found.rows[0]?.id ?? "";
    expect(await resource.setStatus(owner, id, "verified")).toEqual({ ok: true });
    const row = await db.$client.query<{ status: string; verified_by: string }>(
      "select status, verified_by from catalog.products where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "verified", verified_by: owner.id });
  });

  it("the unique rule of brand and part number comes back as text for a new position typed by hand", async () => {
    const data = new FormData();
    for (const [k, v] of Object.entries({
      category: "ram",
      brand: "Kingston",
      model: "Fury Beast",
      mpn: "KF-1",
      color: "black",
      lighting: "none",
      manualOnly: "false",
    })) {
      data.set(k, v);
    }
    const first = await resource.save(owner, null, formDataSource(data));
    expect(first.ok).toBe(true);
    const second = await resource.save(owner, null, formDataSource(data));
    expect(second).toMatchObject({
      ok: false,
      errors: { "": "Позиция с таким брендом и артикулом производителя уже есть." },
    });
  });

  it("filters and searches the list; a pattern character in the search is not a wildcard", async () => {
    const byCategory = await resource.list(owner, { category: "ram" });
    expect(byCategory.rows.every((r) => (r.value as CatalogValue).category === "ram")).toBe(true);
    const search = await resource.list(owner, { q: "fury" });
    expect(search.total).toBeGreaterThanOrEqual(1);
    const wild = await resource.list(owner, { q: "%" });
    expect(wild.total).toBe(0);
    const status = await resource.list(owner, { status: "verified" });
    expect(status.rows.every((r) => (r.value as CatalogValue).status === "verified")).toBe(true);
  });

  it("a made-up id is not found, not an error", async () => {
    expect(await resource.get(owner, "not-a-uuid")).toBeNull();
    expect(await resource.get(owner, randomUUID())).toBeNull();
  });
});
