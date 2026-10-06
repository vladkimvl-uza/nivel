import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import { createProduct } from "./catalog.ts";
import {
  createVendor,
  currentMarketPrices,
  excludeObservation,
  findSkuMapping,
  getVendorByName,
  insertObservation,
  latestFxRate,
  listActiveVendors,
  listObservations,
  restoreObservation,
  saveSkuMapping,
  upsertFxRate,
  upsertMarketPrice,
  upsertOffer,
} from "./pricing.ts";
import { openDb, uniq } from "./testkit.ts";

let db: Db;
let productId: string;
let vendorId: string;

beforeAll(async () => {
  db = openDb("WORKER");
  const admin = openDb("ADMIN");
  try {
    await admin.$client.query(
      `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
       values ('cpu', 'pc', '{"uz":"Protsessor","ru":"Процессор"}', 'pc', 7, true, 1) on conflict (code) do nothing`,
    );
    productId = await createProduct(admin, {
      categoryCode: "cpu",
      brand: "AMD",
      model: "Ryzen 7 9700X",
      slug: `p-${uniq()}`,
      specs: {},
    });
  } finally {
    await admin.$client.end();
  }
  vendorId = await createVendor(db, { name: `V ${uniq()}`, kind: "shop", priceSource: "csv" });
});
afterAll(async () => {
  await db.$client.end();
});

describe("vendors and offers", () => {
  it("finds a vendor by name and lists only active ones", async () => {
    const name = `Partner ${uniq()}`;
    const id = await createVendor(db, { name, kind: "partner", priceSource: "partner_sheet", returnDays: 10 });
    expect((await getVendorByName(db, name))?.id).toBe(id);
    expect(await getVendorByName(db, "nobody")).toBeNull();
    const paused = await createVendor(db, {
      name: `Paused ${uniq()}`,
      kind: "shop",
      priceSource: "manual",
      status: "paused",
    });
    const active = (await listActiveVendors(db)).map((v) => v.id);
    expect(active).toContain(id);
    expect(active).not.toContain(paused);
    await expect(createVendor(db, { name, kind: "shop", priceSource: "manual" })).rejects.toMatchObject({
      code: "unique_violation",
    });
  });

  it("upserts an offer by vendor and article and remembers the match of a price line", async () => {
    const a = await upsertOffer(db, { vendorId, vendorSku: "SKU-1", rawTitle: "AMD Ryzen 7 9700X BOX" });
    const b = await upsertOffer(db, { vendorId, vendorSku: "SKU-1", rawTitle: "AMD Ryzen 7 9700X BOX (new title)" });
    expect(b).toBe(a);
    const matched = await upsertOffer(db, { vendorId, vendorSku: "SKU-2", rawTitle: "R7 9700X", productId });
    expect(matched).not.toBe(a);
    expect(await findSkuMapping(db, vendorId, "SKU-1")).toBeNull();
    await saveSkuMapping(db, { vendorId, vendorSku: "SKU-1", rawTitleNormalized: "amd ryzen 7 9700x box", productId });
    await saveSkuMapping(db, { vendorId, vendorSku: "SKU-1", rawTitleNormalized: "amd ryzen 7 9700x", productId });
    expect(await findSkuMapping(db, vendorId, "SKU-1")).toMatchObject({
      rawTitleNormalized: "amd ryzen 7 9700x",
      productId,
    });
  });
});

describe("rates", () => {
  it("keeps the rate as the string the CBU published and updates a day on a repeated fetch", async () => {
    await upsertFxRate(db, {
      ccy: "USD",
      rate: "11772.9500",
      effectiveDate: "2036-10-05",
      source: "cbu_json",
      diff: "-12.3000",
    });
    await upsertFxRate(db, { ccy: "USD", rate: "11780.0500", effectiveDate: "2036-10-05", source: "cbu_json" });
    await upsertFxRate(db, { ccy: "USD", rate: "11800.0000", effectiveDate: "2036-10-07", source: "cbu_json" });
    const sameDay = await latestFxRate(db, "USD", "2036-10-05");
    expect(sameDay).toMatchObject({ rate: "11780.0500", effectiveDate: "2036-10-05" });
    // A day without a rate uses the previous one.
    expect((await latestFxRate(db, "USD", "2036-10-06"))?.effectiveDate).toBe("2036-10-05");
    expect(((await latestFxRate(db, "USD"))?.effectiveDate ?? "") >= "2036-10-07").toBe(true);
    expect(await latestFxRate(db, "EUR", "2000-01-01")).toBeNull();
    await expect(
      upsertFxRate(db, { ccy: "USD", rate: "0", effectiveDate: "2036-10-08", source: "manual" }),
    ).rejects.toMatchObject({
      code: "check_violation",
      constraint: "fx_rates_rate_chk",
    });
  });

  it("converts a dollar price by the stored rate without a float (whole sums, half up)", async () => {
    // The conversion itself belongs to packages/domain; the database keeps the rate exactly.
    const row = await db.$client.query<{ s: string }>(
      "select (1000 * rate)::text as s from pricing.fx_rates where effective_date = '2036-10-05' and ccy = 'USD'",
    );
    expect(row.rows[0]?.s).toBe("11780050.0000");
  });
});

describe("observations", () => {
  it("appends, lists newest first without the excluded ones, and excludes with a reason", async () => {
    const make = (price: number, at: string) =>
      insertObservation(db, {
        productId,
        vendorId,
        priceSum: price,
        availability: "in_stock",
        source: "partner_csv",
        observedAt: new Date(at),
      });
    const a = await make(2_590_000, "2026-10-01T10:00:00Z");
    const b = await make(2_600_000, "2026-10-03T10:00:00Z");
    const c = await make(90_000, "2026-10-04T10:00:00Z");
    expect((await listObservations(db, productId)).map((o) => o.id)).toEqual([c, b, a]);
    await excludeObservation(db, c, "currency_error");
    expect((await listObservations(db, productId)).map((o) => o.id)).toEqual([b, a]);
    expect((await listObservations(db, productId, { includeExcluded: true })).map((o) => o.id)).toEqual([c, b, a]);
    expect(
      (await listObservations(db, productId, { since: new Date("2026-10-02T00:00:00Z") })).map((o) => o.id),
    ).toEqual([b]);
    expect((await listObservations(db, productId, { limit: 1, includeExcluded: true })).map((o) => o.id)).toEqual([c]);
    await restoreObservation(db, c);
    expect((await listObservations(db, productId)).map((o) => o.id)).toEqual([c, b, a]);
  });

  it("refuses a dollar price without its rate and a zero price, naming the rule", async () => {
    await expect(
      insertObservation(db, {
        productId,
        vendorId,
        priceSum: 100,
        origCurrency: "USD",
        availability: "in_stock",
        source: "manual",
      }),
    ).rejects.toMatchObject({ constraint: "price_observations_usd_chk" });
    await expect(
      insertObservation(db, { productId, vendorId, priceSum: 0, availability: "in_stock", source: "manual" }),
    ).rejects.toMatchObject({
      constraint: "price_observations_price_chk",
    });
    const fx = await upsertFxRate(db, {
      ccy: "USD",
      rate: "12000.0000",
      effectiveDate: "2036-11-01",
      source: "manual",
    });
    await expect(
      insertObservation(db, {
        productId,
        vendorId,
        priceSum: 1_200_000,
        origAmount: "100.00",
        origCurrency: "USD",
        fxRateId: fx,
        availability: "in_stock",
        source: "manual",
      }),
    ).resolves.toBeTypeOf("string");
  });
});

describe("market prices", () => {
  it("replaces the price of the same day, keeps the days apart and shows the latest in the view", async () => {
    const other = openDb("ADMIN");
    let p2: string;
    try {
      p2 = await createProduct(other, {
        categoryCode: "cpu",
        brand: "AMD",
        model: "Ryzen 5 9600X",
        slug: `p-${uniq()}`,
        specs: {},
      });
    } finally {
      await other.$client.end();
    }
    await upsertMarketPrice(db, {
      productId: p2,
      asOf: "2026-10-04",
      medianSum: 2_800_000,
      fromSum: 2_700_000,
      minSum: 2_700_000,
      maxSum: 2_900_000,
      offersN: 3,
      vendorsN: 3,
      maxAgeDays: 2,
      confidence: "medium",
    });
    await upsertMarketPrice(db, {
      productId: p2,
      asOf: "2026-10-05",
      medianSum: 2_806_000,
      fromSum: 2_750_000,
      offersN: 3,
      vendorsN: 3,
      maxAgeDays: 0,
      confidence: "medium",
    });
    await upsertMarketPrice(db, {
      productId: p2,
      asOf: "2026-10-05",
      medianSum: 2_810_000,
      fromSum: 2_750_000,
      offersN: 4,
      vendorsN: 4,
      maxAgeDays: 0,
      confidence: "medium",
      flags: ["same_price_cluster"],
    });
    const [now] = await currentMarketPrices(db, [p2]);
    expect(now).toEqual({
      productId: p2,
      asOf: "2026-10-05",
      medianSum: 2_810_000,
      fromSum: 2_750_000,
      vendorsN: 4,
      confidence: "medium",
      isDemo: false,
    });
    const days = await db.$client.query("select count(*)::int as n from pricing.market_prices where product_id = $1", [
      p2,
    ]);
    expect(days.rows[0]?.n).toBe(2);
    expect((await currentMarketPrices(db)).some((r) => r.productId === p2)).toBe(true);
    expect(await currentMarketPrices(db, ["00000000-0000-7000-8000-000000000000"])).toEqual([]);
  });

  it("stores less than three vendors as a price without a median and refuses a median with them", async () => {
    await upsertMarketPrice(db, {
      productId,
      asOf: "2026-10-05",
      medianSum: null,
      fromSum: 2_590_000,
      offersN: 2,
      vendorsN: 2,
      confidence: "low",
    });
    const [row] = await currentMarketPrices(db, [productId]);
    expect(row).toMatchObject({ medianSum: null, fromSum: 2_590_000, confidence: "low" });
    await expect(
      upsertMarketPrice(db, {
        productId,
        asOf: "2026-10-06",
        medianSum: 2_590_000,
        offersN: 2,
        vendorsN: 2,
        confidence: "low",
      }),
    ).rejects.toMatchObject({ constraint: "market_prices_min_vendors_chk" });
  });
});
