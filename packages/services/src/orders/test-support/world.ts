// A small world for the integration tests of the scenarios (not part of the public API; excluded from coverage):
// four runtimes of the same throwaway database, one per role of the application, with a shared fake clock, a catalog of
// eight positions with market prices, published offers, the accounts of the owner and the assistant and one shop.
// The harness (packages/testing) has already pointed every DATABASE_URL_* at the database of this test file.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { categories, createDb, type Db, marketPrices, vendors } from "@nivel/db";
import { catalog, content, ops, sales } from "@nivel/db/repos";
import type { BuildLine, CategoryCode, ProductId } from "@nivel/domain/catalog";
import { createRuntime, type DbRole, type Runtime } from "../runtime.ts";

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
  readFileSync(new URL("../../../../testing/fixtures/wp-03/default-specs.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

/** The positions of the PC of the tests: category, whole median price in sums, whether the position is returnable. */
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
export const PC_COMPONENTS_SUM = PC_CATALOG.reduce((s, p) => s + p.price, 0);

const CATEGORIES: readonly { code: CategoryCode; fee: "pc" | "mount" | "outside_scale"; returnable: boolean }[] = [
  { code: "cpu", fee: "pc", returnable: true },
  { code: "mb", fee: "pc", returnable: true },
  { code: "ram", fee: "pc", returnable: true },
  { code: "ssd", fee: "pc", returnable: true },
  { code: "gpu", fee: "pc", returnable: true },
  { code: "psu", fee: "pc", returnable: true },
  { code: "case", fee: "pc", returnable: true },
  { code: "cooler_air", fee: "pc", returnable: true },
  { code: "fan", fee: "pc", returnable: true },
  { code: "os_license", fee: "outside_scale", returnable: false },
  { code: "cable_mgmt", fee: "mount", returnable: true },
];

export interface World {
  clock: FakeClock;
  admin: Runtime;
  bot: Runtime;
  web: Runtime;
  worker: Runtime;
  /** The handle of the admin role: for seeding and for looking at what the scenarios wrote. */
  db: Db;
  products: Record<PcKey, { id: ProductId; price: number }>;
  /** A position without a median price (two shops only): its price is uncertain. */
  uncertainFan: { id: ProductId; fromSum: number };
  vendorId: string;
  owner: { id: string; telegramId: string };
  assistant: { id: string; telegramId: string };
  offerIds: { uz: string; ru: string } | null;
  close(): Promise<void>;
}

export interface WorldOptions {
  /** "published": both offers published (the default); "stub": stub versions only; "none": no documents at all. */
  offers?: "published" | "stub" | "none";
  holidays?: string[];
  appMode?: "development" | "staging" | "production";
}

function urlOf(role: string): string {
  const url = process.env[`DATABASE_URL_${role}`];
  if (!url) throw new Error(`DATABASE_URL_${role} is not set (integration project only)`);
  return url;
}

export async function createWorld(o: WorldOptions = {}): Promise<World> {
  const clock = new FakeClock();
  const appMode = o.appMode ?? "production";
  const handles: Db[] = [];
  const runtime = (role: DbRole, env: string): Runtime => {
    const db = createDb(urlOf(env), { max: 4 });
    handles.push(db);
    return createRuntime({ db, role, appMode, now: clock.now });
  };
  const admin = runtime("admin", "ADMIN");
  const bot = runtime("bot", "BOT");
  const web = runtime("web", "WEB");
  const worker = runtime("worker", "WORKER");
  const db = admin.db;

  for (const [i, c] of CATEGORIES.entries()) {
    await db.insert(categories).values({
      code: c.code,
      group: "pc",
      name: { uz: c.code, ru: c.code },
      feeGroupDefault: c.fee,
      freshnessDays: 7,
      returnableDefault: c.returnable,
      sort: i + 1,
    });
  }

  const products = {} as World["products"];
  for (const p of PC_CATALOG) {
    const id = await catalog.createProduct(db, {
      slug: `${p.key}-test`,
      categoryCode: p.category,
      brand: p.brand,
      model: p.model,
      specs: specs[p.category] ?? {},
      status: "verified",
      returnable: p.returnable,
    });
    await db.insert(marketPrices).values({
      productId: id,
      asOf: "2026-10-12",
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
  const fanId = await catalog.createProduct(db, {
    slug: "fan-test",
    categoryCode: "fan",
    brand: "Arctic",
    model: "P12",
    specs: { sizeMm: 120, count: 1, conn: "4pin", argb: false },
    status: "verified",
  });
  await db.insert(marketPrices).values({
    productId: fanId,
    asOf: "2026-10-12",
    medianSum: null,
    fromSum: 80_000,
    minSum: 80_000,
    maxSum: 95_000,
    offersN: 2,
    vendorsN: 2,
    maxAgeDays: 2,
    confidence: "low",
  });

  const [vendor] = await db
    .insert(vendors)
    .values({ name: "Test shop", kind: "shop", priceSource: "manual" })
    .returning({ id: vendors.id });
  if (!vendor) throw new Error("vendor was not written");

  const ownerTelegram = 6_001_000_001;
  const assistantTelegram = 6_001_000_002;
  const ownerId = await ops.createAdminUser(db, {
    email: "owner@nivel.test",
    passwordHash: "x",
    role: "owner",
    telegramUserId: ownerTelegram,
  });
  const assistantId = await ops.createAdminUser(db, {
    email: "assistant@nivel.test",
    passwordHash: "x",
    role: "assistant",
    telegramUserId: assistantTelegram,
  });

  let offerIds: World["offerIds"] = null;
  if (o.offers !== "none") {
    const make = async (lang: "uz" | "ru") => {
      const id = await content.createLegalDocument(db, {
        kind: "offer",
        version: "test-1",
        lang,
        bodyMd: `Offer ${lang} test version`,
        effectiveFrom: "2026-10-01",
      });
      if (o.offers !== "stub") await content.publishLegalDocument(db, id, "2026-10-01");
      return id;
    };
    offerIds = { uz: await make("uz"), ru: await make("ru") };
  }
  if (o.holidays) {
    await ops.setSetting(
      db,
      "calendar.work",
      { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: o.holidays },
      "test",
    );
  }

  return {
    clock,
    admin,
    bot,
    web,
    worker,
    db,
    products,
    uncertainFan: { id: fanId as ProductId, fromSum: 80_000 },
    vendorId: vendor.id,
    owner: { id: ownerId, telegramId: String(ownerTelegram) },
    assistant: { id: assistantId, telegramId: String(assistantTelegram) },
    offerIds,
    async close() {
      await Promise.all(handles.map((h) => h.$client.end()));
    },
  };
}

let sequence = 0;
/** A new customer with a Telegram id, made by the admin role. */
export async function newCustomer(w: World, lang: "uz" | "ru" = "uz"): Promise<string> {
  sequence += 1;
  return sales.createCustomer(w.db, {
    displayName: `Customer ${sequence}`,
    telegramUserId: 7_100_000_000 + sequence,
    lang,
  });
}

/** The eight positions of the PC as lines of a build. */
export function pcLines(w: World): BuildLine[] {
  return PC_CATALOG.map((p) => ({ productId: w.products[p.key].id, qty: 1 }));
}

/** A registered file (a photo of a receipt, a statement): the registry row only, the bytes are not needed here. */
export async function newFile(
  w: World,
  o: { kind?: string; retention?: "order_warranty_plus_3y" | "tax_5y" } = {},
): Promise<string> {
  const key = `test/${randomUUID()}`;
  return ops.registerFile(w.db, {
    sha256: createHash("sha256").update(key).digest("hex"),
    mime: "image/jpeg",
    bytes: 1024,
    storageKey: key,
    kind: o.kind ?? "receipt_photo",
    isPublic: false,
    containsPd: false,
    retentionClass: o.retention ?? "tax_5y",
    createdBy: "test",
  });
}
