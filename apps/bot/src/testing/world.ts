// A small world for the integration tests of the bot (not part of the app; excluded from coverage): one throwaway
// database (the harness of packages/testing points every DATABASE_URL_* at it), the runtimes of the admin and of the bot
// with one fake clock, a catalog with market prices, a price class with a showcase template, the offers, the accounts
// of the owner and of the assistant, one shop and the settings the bot reads. The owner's actions that the admin panel
// does in production (convert a lead, build and send the quote, record a purchase) are made with the admin runtime.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  baseBuildItems,
  baseBuilds,
  categories,
  createDb,
  type Db,
  marketPrices,
  priceClasses,
  vendors,
} from "@nivel/db";
import { catalog, content, ops, sales } from "@nivel/db/repos";
import type { BuildLine, CategoryCode, ProductId } from "@nivel/domain/catalog";
import { orders } from "@nivel/services";

type Runtime = orders.Runtime;
type DbRole = orders.DbRole;

// The characteristics a verified position must have (the fixture of WP-03: one default set per category).
const specs = JSON.parse(
  readFileSync(new URL("../../../../packages/testing/fixtures/wp-03/default-specs.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

/** Monday 12 October 2026, 10:00 in Tashkent. */
export const T0 = new Date("2026-10-12T10:00:00+05:00");

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
];

export interface BotWorld {
  clock: FakeClock;
  admin: Runtime;
  bot: Runtime;
  db: Db;
  products: Record<PcKey, { id: ProductId; price: number }>;
  vendorId: string;
  owner: { id: string; telegramId: number };
  assistant: { id: string; telegramId: number };
  /** The id of the owner's group (a supergroup with topics). */
  groupId: number;
  close(): Promise<void>;
}

export interface BotWorldOptions {
  /** "published": both offers published; "stub": stub versions only (the default is production, like the real thing). */
  offers?: "published" | "stub";
  appMode?: "development" | "staging" | "production";
  /** Writes the setting telegram.owner_group_id (default true). */
  withGroup?: boolean;
  /** Seeds a showcase template (gaming, tier 2, style A) built from a price class with priced products. */
  withTemplate?: boolean;
  /** The seeded template is marked as demo data (shown with a plate, never in production). */
  templateDemo?: boolean;
  /** Seeds the texts of the policy (response hours) and the privacy documents. */
  withPolicies?: boolean;
}

function urlOf(role: string): string {
  const url = process.env[`DATABASE_URL_${role}`];
  if (!url) throw new Error(`DATABASE_URL_${role} is not set (integration project only)`);
  return url;
}

export const OWNER_TELEGRAM = 6_001_000_001;
export const ASSISTANT_TELEGRAM = 6_001_000_002;
export const GROUP_ID = -1_001_234_567_890;

export async function createBotWorld(o: BotWorldOptions = {}): Promise<BotWorld> {
  const clock = new FakeClock();
  const appMode = o.appMode ?? "production";
  const handles: Db[] = [];
  const runtime = (role: DbRole, env: string): Runtime => {
    const db = createDb(urlOf(env), { max: 4 });
    handles.push(db);
    return orders.createRuntime({ db, role, appMode, now: clock.now });
  };
  const admin = runtime("admin", "ADMIN");
  const bot = runtime("bot", "BOT");
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
  const classes = o.withTemplate ? await seedPriceClasses(db) : null;
  const productIds = {} as BotWorld["products"];
  for (const p of PC_CATALOG) {
    const id = await catalog.createProduct(db, {
      slug: `${p.key}-test`,
      categoryCode: p.category,
      brand: p.brand,
      model: p.model,
      specs: specs[p.category] ?? {},
      status: "verified",
      returnable: p.returnable,
      ...(classes && p.key === "cpu" ? { priceClassId: classes.cpu } : {}),
      ...(classes && p.key === "gpu" ? { priceClassId: classes.gpu } : {}),
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
    productIds[p.key] = { id: id as ProductId, price: p.price };
  }
  const [vendor] = await db
    .insert(vendors)
    .values({ name: "Test shop", kind: "shop", priceSource: "manual" })
    .returning({ id: vendors.id });
  if (!vendor) throw new Error("vendor was not written");

  const ownerId = await ops.createAdminUser(db, {
    email: "owner@nivel.test",
    passwordHash: "x",
    role: "owner",
    telegramUserId: OWNER_TELEGRAM,
  });
  const assistantId = await ops.createAdminUser(db, {
    email: "assistant@nivel.test",
    passwordHash: "x",
    role: "assistant",
    telegramUserId: ASSISTANT_TELEGRAM,
  });

  const makeOffer = async (lang: "uz" | "ru") => {
    const id = await content.createLegalDocument(db, {
      kind: "offer",
      version: "test-1",
      lang,
      bodyMd: `Offer ${lang} test version`,
      effectiveFrom: "2026-10-01",
    });
    if (o.offers !== "stub") await content.publishLegalDocument(db, id, "2026-10-01");
  };
  await makeOffer("uz");
  await makeOffer("ru");

  if (o.withGroup !== false) await ops.setSetting(db, "telegram.owner_group_id", GROUP_ID, "test");
  if (classes) await seedTemplate(db, productIds, classes, o.templateDemo === true);
  if (o.withPolicies) await seedPolicies(db);

  return {
    clock,
    admin,
    bot,
    db,
    products: productIds,
    vendorId: vendor.id,
    owner: { id: ownerId, telegramId: OWNER_TELEGRAM },
    assistant: { id: assistantId, telegramId: ASSISTANT_TELEGRAM },
    groupId: GROUP_ID,
    async close() {
      await Promise.all(handles.map((h) => h.$client.end()));
    },
  };
}

async function seedPriceClasses(db: Db): Promise<{ cpu: string; gpu: string }> {
  const [cpuClass] = await db
    .insert(priceClasses)
    .values({ categoryCode: "cpu", key: "cpu.test", name: { uz: "CPU test", ru: "CPU test" } })
    .returning({ id: priceClasses.id });
  const [gpuClass] = await db
    .insert(priceClasses)
    .values({ categoryCode: "gpu", key: "gpu.test", name: { uz: "GPU test", ru: "GPU test" } })
    .returning({ id: priceClasses.id });
  if (!cpuClass || !gpuClass) throw new Error("price classes were not written");
  return { cpu: cpuClass.id, gpu: gpuClass.id };
}

/** gaming / T2 / style A / base: the CPU and the GPU come from price classes whose products have market prices. */
async function seedTemplate(
  db: Db,
  ids: BotWorld["products"],
  classes: { cpu: string; gpu: string },
  demo: boolean,
): Promise<void> {
  const [build] = await db
    .insert(baseBuilds)
    .values({
      task: "gaming",
      tier: "T2",
      style: "A",
      variant: "base",
      status: "offered",
      explain: { uz: "Oʻyinlar uchun muvozanatli tizim.", ru: "Сбалансированная система для игр." },
      isShowcase: true,
      isDemo: demo,
    })
    .returning({ id: baseBuilds.id });
  if (!build) throw new Error("template was not written");
  await db.insert(baseBuildItems).values([
    { baseBuildId: build.id, position: 1, slot: "cpu", priceClassId: classes.cpu, qty: 1, role: "primary" },
    { baseBuildId: build.id, position: 2, slot: "gpu", priceClassId: classes.gpu, qty: 1, role: "primary" },
    { baseBuildId: build.id, position: 3, slot: "case", productId: ids.case.id, qty: 1, role: "support" },
  ]);
}

async function seedPolicies(db: Db): Promise<void> {
  await content.addPolicyVersion(
    db,
    "response_hours",
    {
      uz: "Usta ish vaqtida 2 soat ichida javob beradi (du–sha 10:00–19:00).",
      ru: "Мастер отвечает в рабочее время в течение 2 часов (пн–сб 10:00–19:00).",
    },
    "approved",
  );
  for (const lang of ["uz", "ru"] as const) {
    const id = await content.createLegalDocument(db, {
      kind: "consent_pd",
      version: "v1",
      lang,
      bodyMd: `Consent to the processing of personal data (${lang})`,
      effectiveFrom: "2026-10-01",
    });
    await content.publishLegalDocument(db, id, "2026-10-01");
  }
}

let counter = 0;
/** A registered file (a photo of a receipt): the registry row only, the bytes are not needed here. */
export async function newFile(w: BotWorld, kind = "receipt_photo"): Promise<string> {
  counter += 1;
  const key = `test/${randomUUID()}-${counter}`;
  return ops.registerFile(w.db, {
    sha256: createHash("sha256").update(key).digest("hex"),
    mime: "image/jpeg",
    bytes: 1024,
    storageKey: key,
    kind,
    isPublic: false,
    containsPd: false,
    retentionClass: "tax_5y",
    createdBy: "test",
  });
}

export const pcLines = (w: BotWorld): BuildLine[] =>
  PC_CATALOG.map((p) => ({ productId: w.products[p.key].id, qty: 1 }));

export { sales };
