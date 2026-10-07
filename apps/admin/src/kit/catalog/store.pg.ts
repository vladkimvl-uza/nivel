// The catalog on PostgreSQL (catalog.products) for the admin kit. Every write and its journal entry share one
// transaction; the rules of the database (a verified position needs its key characteristics, one position per brand
// and part number) come back to the person as text, not as a stack trace.
import { type Db, products } from "@nivel/db";
import { catalog as catalogRepo, toRuleError } from "@nivel/db/repos";
import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  type ListQuery,
  type ResourceStore,
  RuleViolation,
  type StoredRecord,
  type WriteContext,
} from "../resource.ts";
import { CATALOG_LABELS } from "./labels.ts";
import { type CatalogValue, slugOf } from "./resource.ts";

type Row = typeof products.$inferSelect;

function toValue(row: Row): CatalogValue {
  return {
    category: row.categoryCode,
    brand: row.brand,
    model: row.model,
    ...(row.mpn ? { mpn: row.mpn } : {}),
    color: row.colorBody,
    lighting: row.lighting,
    ...(row.feeGroup ? { feeGroup: row.feeGroup } : {}),
    ...(row.returnable === null ? {} : { returnable: row.returnable }),
    manualOnly: row.manualOnly,
    ...(row.description ? { description: row.description } : {}),
    status: row.status,
    isDemo: row.isDemo,
    spec: row.specs,
  };
}

const SORTABLE = {
  category: products.categoryCode,
  brand: products.brand,
  model: products.model,
  mpn: products.mpn,
  status: products.status,
} as const;

/** Columns written from a value (the identity, status and journal columns have their own rules). */
function columnsOf(v: CatalogValue) {
  return {
    categoryCode: v.category as Row["categoryCode"],
    brand: v.brand,
    model: v.model,
    mpn: v.mpn ?? null,
    colorBody: v.color,
    lighting: v.lighting,
    feeGroup: v.feeGroup ?? null,
    returnable: v.returnable ?? null,
    manualOnly: v.manualOnly,
    description: v.description ?? null,
    specs: v.spec,
  };
}

/** A rule of the database as a sentence for the screen. */
async function explain(db: Db, error: unknown, value: CatalogValue): Promise<never> {
  const rule = toRuleError(error);
  if (!rule) throw error;
  if (rule.code === "unique_violation") {
    if (rule.constraint === "products_brand_mpn_key") {
      throw new RuleViolation("Позиция с таким брендом и артикулом производителя уже есть.");
    }
    throw new RuleViolation("Такая позиция уже есть: совпал адрес (slug).");
  }
  if (rule.code === "foreign_key_violation")
    throw new RuleViolation("Такой категории нет в базе: сначала загрузите категории.");
  if (rule.code === "check_violation" && rule.constraint === "products_verified_spec_complete_chk") {
    const missing = await catalogRepo.missingSpecKeys(db, value.category, value.spec);
    const names = missing.map((k) => CATALOG_LABELS[k] ?? k).join(", ");
    throw new RuleViolation(
      `Нельзя подтвердить: не заполнены ключевые характеристики — ${names || "см. правила совместимости"}.`,
    );
  }
  if (rule.code === "check_violation")
    throw new RuleViolation(`Данные не прошли проверку базы (${rule.constraint ?? "check"}).`);
  throw error;
}

export function createPgCatalogStore(db: Db): ResourceStore<CatalogValue> {
  async function freeSlug(base: string): Promise<string> {
    const stem = base === "" ? "pozitsiya" : base;
    const { rows } = await db.$client.query<{ slug: string }>(
      "select slug from catalog.products where slug = $1 or slug like $2",
      [stem, `${stem}-%`],
    );
    const taken = new Set(rows.map((r) => r.slug));
    if (!taken.has(stem)) return stem;
    for (let n = 2; n < 1000; n += 1) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
    return `${stem}-${Date.now()}`;
  }

  return {
    async list(q: ListQuery) {
      const where: (SQL | undefined)[] = [];
      if (q.filters.category) where.push(eq(products.categoryCode, q.filters.category as Row["categoryCode"]));
      if (q.filters.status) where.push(eq(products.status, q.filters.status as Row["status"]));
      if (q.filters.q) {
        const needle = `%${q.filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(or(ilike(products.brand, needle), ilike(products.model, needle), ilike(products.mpn, needle)));
      }
      const condition = and(...where);
      const column = SORTABLE[q.sort.field as keyof typeof SORTABLE] ?? products.categoryCode;
      const direction = q.sort.dir === "desc" ? desc : asc;
      const rows = await db
        .select()
        .from(products)
        .where(condition)
        .orderBy(direction(column), asc(products.brand), asc(products.model), asc(products.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await db.select({ n: count() }).from(products).where(condition);
      return { rows: rows.map((r) => ({ id: r.id, value: toValue(r) })), total: total?.n ?? 0 };
    },

    async get(id): Promise<StoredRecord<CatalogValue> | null> {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const row = await catalogRepo.getProduct(db, id);
      return row ? { id: row.id, value: toValue(row) } : null;
    },

    async create(value, ctx: WriteContext) {
      const slug = await freeSlug(slugOf(value.brand, value.model, value.mpn));
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(products)
            .values({
              ...columnsOf(value),
              slug,
              status: value.status,
              isDemo: value.isDemo,
              createdBy: ctx.actor.id,
            })
            .returning({ id: products.id });
          if (!row) throw new Error("product was not written");
          await ctx.audit({ action: "create", entityId: row.id, after: value }, tx);
          return { id: row.id };
        });
      } catch (error) {
        return explain(db, error, value);
      }
    },

    async update(id, value, ctx: WriteContext) {
      try {
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
          if (!before) throw new RuleViolation("Запись не найдена.");
          const becomesVerified = value.status === "verified" && before.status !== "verified";
          await tx
            .update(products)
            .set({
              ...columnsOf(value),
              status: value.status,
              ...(becomesVerified ? { verifiedBy: ctx.actor.id } : {}),
            })
            .where(eq(products.id, id));
          await ctx.audit({ action: "update", entityId: id, before: toValue(before), after: value }, tx);
        });
      } catch (error) {
        if (error instanceof RuleViolation) throw error;
        return explain(db, error, value);
      }
    },

    async findByKey(value) {
      const mpn = value.mpn?.trim();
      const { rows } = mpn
        ? await db.$client.query<{ id: string }>(
            "select id from catalog.products where lower(brand) = lower($1) and lower(mpn) = lower($2) limit 1",
            [value.brand.trim(), mpn],
          )
        : await db.$client.query<{ id: string }>(
            "select id from catalog.products where lower(brand) = lower($1) and mpn is null and lower(model) = lower($2) limit 1",
            [value.brand.trim(), value.model.trim()],
          );
      return rows[0]?.id ?? null;
    },
  };
}
