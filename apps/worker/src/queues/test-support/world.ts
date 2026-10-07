// A small world for the integration tests of the worker (not part of the product; excluded from coverage): the test database
// of this file (the harness has pointed every DATABASE_URL_* at it), a catalog of eight positions with market prices, the
// accounts of the owner and the assistant, one shop, published offers, and the services running on the roles admin, bot, web
// and worker with one fake clock. The orders of the tests walk the road of the product through the scenarios of the services
// (flow.ts); the facts the worker looks at (a deadline, a milestone) are real rows made by the same scenarios.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { categories, createDb, type Db, marketPrices, vendors } from "@nivel/db";
import { catalog, content, ops, sales } from "@nivel/db/repos";
import type { BuildLine, CategoryCode, ProductId } from "@nivel/domain/catalog";
import { orders } from "@nivel/services";
import { FakeClock, T0 } from "./fakes.ts";

export { FakeClock, T0 };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const specs = JSON.parse(
  readFileSync(new URL("../../../../../packages/testing/fixtures/wp-03/default-specs.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

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
  { code: "fan", fee: "pc", returnable: true },
  { code: "os_license", fee: "outside_scale", returnable: false },
  { code: "cable_mgmt", fee: "mount", returnable: true },
];

export interface World {
  clock: FakeClock;
  admin: orders.Runtime;
  bot: orders.Runtime;
  web: orders.Runtime;
  worker: orders.Runtime;
  /** The handle of the admin role: for seeding and for looking at what the scenarios wrote. */
  db: Db;
  /** The handle of the role nivel_worker: what the worker itself runs on. */
  workerDb: Db;
  products: Record<PcKey, { id: ProductId; price: number }>;
  vendorId: string;
  owner: { id: string; telegramId: string };
  close(): Promise<void>;
}

function urlOf(role: string): string {
  const url = process.env[`DATABASE_URL_${role}`];
  if (!url) throw new Error(`DATABASE_URL_${role} is not set (integration project only)`);
  return url;
}

export async function createWorld(o: { holidays?: string[] } = {}): Promise<World> {
  const clock = new FakeClock();
  const handles: Db[] = [];
  const handle = (env: string): Db => {
    const db = createDb(urlOf(env), { max: 4 });
    handles.push(db);
    return db;
  };
  const runtime = (role: orders.DbRole, db: Db): orders.Runtime =>
    orders.createRuntime({ db, role, appMode: "production", now: clock.now });
  const db = handle("ADMIN");
  const workerDb = handle("WORKER");
  const admin = runtime("admin", db);
  const bot = runtime("bot", handle("BOT"));
  const web = runtime("web", handle("WEB"));
  const worker = runtime("worker", workerDb);

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
      slug: `${p.key}-worker-test`,
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
  const [vendor] = await db
    .insert(vendors)
    .values({ name: "Test shop", kind: "shop", priceSource: "manual" })
    .returning({ id: vendors.id });
  if (!vendor) throw new Error("vendor was not written");

  const ownerTelegram = 6_001_000_001;
  const ownerId = await ops.createAdminUser(db, {
    email: "owner@nivel.test",
    passwordHash: "x",
    role: "owner",
    telegramUserId: ownerTelegram,
  });
  for (const lang of ["uz", "ru"] as const) {
    const id = await content.createLegalDocument(db, {
      kind: "offer",
      version: "test-1",
      lang,
      bodyMd: `Offer ${lang} test version`,
      effectiveFrom: "2026-10-01",
    });
    await content.publishLegalDocument(db, id, "2026-10-01");
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
    workerDb,
    products,
    vendorId: vendor.id,
    owner: { id: ownerId, telegramId: String(ownerTelegram) },
    async close() {
      await Promise.all(handles.map((h) => h.$client.end()));
    },
  };
}

let sequence = 0;
export async function newCustomer(w: World, lang: "uz" | "ru" = "uz"): Promise<string> {
  sequence += 1;
  return sales.createCustomer(w.db, {
    displayName: `Customer ${sequence}`,
    telegramUserId: 7_200_000_000 + sequence,
    lang,
  });
}

export function pcLines(w: World): BuildLine[] {
  return PC_CATALOG.map((p) => ({ productId: w.products[p.key].id, qty: 1 }));
}

/** A registered file (a photo of a receipt): the row of the registry only, the bytes are not needed here. */
export async function newFile(
  w: World,
  o: {
    kind?: string;
    retention?: "order_warranty_plus_3y" | "tax_5y" | "lead_12m" | "ai_90d" | "media";
    key?: string;
  } = {},
): Promise<{ id: string; key: string }> {
  const key = o.key ?? `test/${randomUUID()}`;
  const id = await ops.registerFile(w.db, {
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
  return { id, key };
}
