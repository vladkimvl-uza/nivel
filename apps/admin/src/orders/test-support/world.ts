// A small world for the integration tests and the browser tests of the orders screens (not part of the application):
// a catalog of eight positions with market prices, one shop, published offers, and one runtime of the services per role
// of the database over the same throwaway database. The roles of the bot and the site act for the customer, as in the
// bot and on the site, the worker closes the order: the admin never does these.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { categories, createDb, type Db, marketPrices, vendors } from "@nivel/db";
import { catalog, content, ops, sales } from "@nivel/db/repos";
import type { BuildLine, CategoryCode, ProductId } from "@nivel/domain/catalog";
import { orders } from "@nivel/services";

/** Monday 12 October 2026, 10:00 in Tashkent. */
export const T0 = new Date("2026-10-12T10:00:00+05:00");
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export class FakeClock {
  private current: Date;
  constructor(start: Date = T0) {
    this.current = start;
  }
  now = (): Date => new Date(this.current.getTime());
  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
  advance(ms: number): Date {
    this.current = new Date(this.current.getTime() + ms);
    return this.now();
  }
}

const specs = JSON.parse(
  readFileSync(new URL("../../../../../packages/testing/fixtures/wp-03/default-specs.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

/** The positions of the PC: category, whole median price in sums, whether the position is returnable. */
export const PC_CATALOG = [
  { key: "cpu", category: "cpu", brand: "Ryzen", model: "5 7600", price: 2_800_000, returnable: true },
  { key: "mb", category: "mb", brand: "MSI", model: "B650M", price: 1_700_000, returnable: true },
  { key: "ram", category: "ram", brand: "Kingston", model: "Fury 32", price: 1_100_000, returnable: true },
  { key: "ssd", category: "ssd", brand: "WD", model: "SN850 1TB", price: 900_000, returnable: false },
  { key: "gpu", category: "gpu", brand: "Gigabyte", model: "RTX 5060", price: 3_600_000, returnable: true },
  { key: "psu", category: "psu", brand: "Corsair", model: "RM650", price: 750_000, returnable: true },
  { key: "case", category: "case", brand: "Deepcool", model: "CH370", price: 650_000, returnable: true },
  { key: "cooler", category: "cooler_air", brand: "Thermalright", model: "PA120", price: 350_000, returnable: true },
] as const;
export type PcKey = (typeof PC_CATALOG)[number]["key"];

const CATEGORIES: readonly { code: CategoryCode; fee: "pc" | "mount" | "outside_scale"; returnable: boolean }[] = [
  { code: "cpu", fee: "pc", returnable: true },
  { code: "mb", fee: "pc", returnable: true },
  { code: "ram", fee: "pc", returnable: true },
  { code: "ssd", fee: "pc", returnable: true },
  { code: "gpu", fee: "pc", returnable: true },
  { code: "psu", fee: "pc", returnable: true },
  { code: "case", fee: "pc", returnable: true },
  { code: "cooler_air", fee: "pc", returnable: true },
  { code: "os_license", fee: "outside_scale", returnable: false },
  { code: "cable_mgmt", fee: "mount", returnable: true },
];

export interface CatalogSeed {
  products: Record<PcKey, { id: ProductId; price: number }>;
  vendorId: string;
}

/**
 * Categories, the eight positions with a market price, a shop and, when asked, the offers in both languages. Safe to run
 * on a database that already has some of the categories (the browser harness adds two of its own).
 */
export async function seedCatalog(
  db: Db,
  o: { offers?: "published" | "stub" | "none"; asOf?: string; suffix?: string } = {},
): Promise<CatalogSeed & { offerIds: { uz: string; ru: string } | null }> {
  const suffix = o.suffix ?? "";
  const asOf = o.asOf ?? "2026-10-12";
  for (const [i, c] of CATEGORIES.entries()) {
    await db
      .insert(categories)
      .values({
        code: c.code,
        group: "pc",
        name: { uz: c.code, ru: c.code },
        feeGroupDefault: c.fee,
        freshnessDays: 7,
        returnableDefault: c.returnable,
        sort: 100 + i,
      })
      .onConflictDoNothing();
  }
  const products = {} as CatalogSeed["products"];
  for (const p of PC_CATALOG) {
    const id = await catalog.createProduct(db, {
      slug: `${p.key}-test${suffix}`,
      categoryCode: p.category,
      brand: p.brand,
      model: p.model,
      specs: specs[p.category] ?? {},
      status: "verified",
      returnable: p.returnable,
    });
    await db.insert(marketPrices).values({
      productId: id,
      asOf,
      medianSum: p.price,
      fromSum: p.price,
      minSum: p.price,
      maxSum: p.price,
      offersN: 5,
      vendorsN: 5,
      maxAgeDays: 1,
      confidence: "high",
    });
    products[p.key] = { id: id as ProductId, price: p.price };
  }
  const [vendor] = await db
    .insert(vendors)
    .values({ name: `Test shop${suffix}`, kind: "shop", priceSource: "manual" })
    .returning({ id: vendors.id });
  if (!vendor) throw new Error("vendor was not written");

  let offerIds: { uz: string; ru: string } | null = null;
  if (o.offers !== "none") {
    const make = async (lang: "uz" | "ru") => {
      const id = await content.createLegalDocument(db, {
        kind: "offer",
        version: `test-${randomUUID().slice(0, 8)}`,
        lang,
        bodyMd: `Offer ${lang} test version`,
        effectiveFrom: "2026-10-01",
      });
      if (o.offers !== "stub") await content.publishLegalDocument(db, id, "2026-10-01");
      return id;
    };
    offerIds = { uz: await make("uz"), ru: await make("ru") };
  }
  return { products, vendorId: vendor.id, offerIds };
}

export interface World {
  clock: FakeClock;
  admin: orders.Runtime;
  bot: orders.Runtime;
  web: orders.Runtime;
  worker: orders.Runtime;
  /** The handle of the admin role: for seeding and for looking at what the scenarios wrote. */
  db: Db;
  products: CatalogSeed["products"];
  vendorId: string;
  owner: { id: string };
  assistant: { id: string };
  close(): Promise<void>;
}

export interface WorldUrls {
  ADMIN: string;
  BOT: string;
  WEB: string;
  WORKER: string;
}

function urlOf(role: keyof WorldUrls, given?: WorldUrls): string {
  const url = given?.[role] ?? process.env[`DATABASE_URL_${role}`];
  if (!url) throw new Error(`DATABASE_URL_${role} is not set (integration project only)`);
  return url;
}

/** Four runtimes of the services over one database; `now` is the clock they share. */
export function createRuntimes(o: { urls?: WorldUrls; clock?: () => Date; appMode?: orders.AppMode } = {}) {
  const handles: Db[] = [];
  const make = (role: orders.DbRole, key: keyof WorldUrls): orders.Runtime => {
    const db = createDb(urlOf(key, o.urls), { max: 3 });
    handles.push(db);
    return orders.createRuntime({
      db,
      role,
      appMode: o.appMode ?? "production",
      ...(o.clock ? { now: o.clock } : {}),
    });
  };
  const admin = make("admin", "ADMIN");
  return {
    admin,
    bot: make("bot", "BOT"),
    web: make("web", "WEB"),
    worker: make("worker", "WORKER"),
    close: async () => {
      await Promise.all(handles.map((h) => h.$client.end()));
    },
  };
}

export async function createWorld(
  o: { offers?: "published" | "stub" | "none"; appMode?: orders.AppMode } = {},
): Promise<World> {
  const clock = new FakeClock();
  const rts = createRuntimes({ clock: clock.now, ...(o.appMode ? { appMode: o.appMode } : {}) });
  const db = rts.admin.db;
  const seeded = await seedCatalog(db, { ...(o.offers ? { offers: o.offers } : {}) });
  const ownerId = await ops.createAdminUser(db, {
    email: "owner@nivel.test",
    passwordHash: "x",
    role: "owner",
    telegramUserId: 6_001_000_001,
  });
  const assistantId = await ops.createAdminUser(db, {
    email: "assistant@nivel.test",
    passwordHash: "x",
    role: "assistant",
    telegramUserId: 6_001_000_002,
  });
  return {
    clock,
    admin: rts.admin,
    bot: rts.bot,
    web: rts.web,
    worker: rts.worker,
    db,
    products: seeded.products,
    vendorId: seeded.vendorId,
    owner: { id: ownerId },
    assistant: { id: assistantId },
    close: rts.close,
  };
}

let sequence = 0;
/** A new customer with a Telegram id and a name. */
export async function newCustomer(db: Db, name?: string): Promise<string> {
  sequence += 1;
  return sales.createCustomer(db, {
    displayName: name ?? `Клиент ${sequence}`,
    telegramUserId: 7_300_000_000 + sequence + Math.floor(Math.random() * 1_000_000),
    lang: "ru",
  });
}

/** The eight positions of the PC as lines of a build. */
export function pcLines(products: CatalogSeed["products"]): BuildLine[] {
  return PC_CATALOG.map((p) => ({ productId: products[p.key].id, qty: 1 }));
}

/** A registered file (a photo of a receipt, a statement): the row of the registry only, the bytes are not needed here. */
export async function newFile(db: Db, o: { kind?: string; retention?: "order_warranty_plus_3y" | "tax_5y" } = {}) {
  const key = `test/${randomUUID()}`;
  return ops.registerFile(db, {
    sha256: createHash("sha256").update(key).digest("hex"),
    mime: "image/jpeg",
    bytes: 1024,
    storageKey: key,
    kind: o.kind ?? "receipt",
    isPublic: false,
    containsPd: false,
    retentionClass: o.retention ?? "tax_5y",
    createdBy: "test",
  });
}
