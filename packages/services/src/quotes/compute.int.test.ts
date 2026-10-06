import { marketPrices } from "@nivel/db";
import { catalog, ops } from "@nivel/db/repos";
import type { ProductId } from "@nivel/domain/catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "../orders/errors.ts";
import { createWorld, HOUR, PC_COMPONENTS_SUM, pcLines, type World } from "../orders/test-support/world.ts";
import { computeQuoteFor } from "./compute.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const base = () => ({ kind: "pc" as const, freeWindowAvailable: false, now: w.clock.now() });

describe("computeQuoteFor: the estimate is calculated on the server from the market prices", () => {
  it("prices the PC at the median of each position and applies the scale of the fee", async () => {
    const q = await computeQuoteFor(w.db, { ...base(), lines: pcLines(w) });
    const fee = (PC_COMPONENTS_SUM * 1500) / 10_000; // 15 % below 20 million, rounded down to a whole sum
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM);
    expect(q.totals.fee.total).toBe(Math.floor(fee));
    expect(q.totals.reserveBp).toBe(300);
    expect(q.totals.reserveSum).toBe(360_000); // 3 % of 11 850 000 = 355 500, up to the step of 10 000
    expect(q.totals.purchaseLimit).toBe(PC_COMPONENTS_SUM + 360_000);
    expect(q.totals.advance + q.totals.final).toBe(q.totals.fee.total);
    expect(q.totals.grandTotal).toBe(q.totals.purchaseLimit + q.totals.fee.total);
    expect(q.totals.eligibility).toEqual({ mode: "full_cycle" });
    expect(q.lines).toHaveLength(8);
    expect(q.lines.map((l) => l.unitMarketSum).sort((a, b) => a - b)).toEqual([
      350_000, 650_000, 750_000, 900_000, 1_100_000, 1_700_000, 2_800_000, 3_600_000,
    ]);
  });

  it("always sets the term of the estimate: 24 hours from now", async () => {
    const q = await computeQuoteFor(w.db, { ...base(), lines: pcLines(w) });
    expect(q.totals.validUntil).toEqual(new Date(w.clock.now().getTime() + 24 * HOUR));
    expect(q.shelfLifeHours).toBe(24);
  });

  it("gives 72 hours when every line is furniture, light, decor or acoustics", async () => {
    const q = await computeQuoteFor(w.db, {
      ...base(),
      kind: "setup",
      lines: [],
      manualLines: [{ title: "Desk 160x80", categoryCode: "desk", feeGroup: "mount", qty: 1, unitSum: 4_000_000 }],
    });
    expect(q.shelfLifeHours).toBe(72);
    expect(q.totals.validUntil).toEqual(new Date(w.clock.now().getTime() + 72 * HOUR));
  });

  it("ignores any price that came with the lines", async () => {
    const lines = pcLines(w).map((l) => ({ ...l, unitSum: 1, unitMarketSum: 1 }));
    const q = await computeQuoteFor(w.db, { ...base(), lines });
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM);
  });

  it("takes the lowest offer of a position without a median and says the price is uncertain", async () => {
    const q = await computeQuoteFor(w.db, {
      ...base(),
      lines: [...pcLines(w), { productId: w.uncertainFan.id, qty: 2 }],
    });
    const fan = q.lines.find((l) => l.productId === w.uncertainFan.id);
    expect(fan?.unitMarketSum).toBe(w.uncertainFan.fromSum);
    expect(fan?.confidence).toBe("low");
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM + 2 * w.uncertainFan.fromSum);
    expect(q.totals.warnings).toContainEqual({
      key: "quote.price_uncertain",
      params: { productId: w.uncertainFan.id },
    });
  });

  it("marks the positions of the customer: no fee, no purchase", async () => {
    const lines = pcLines(w).map((l) => (l.productId === w.products.ssd.id ? { ...l, customerOwned: true } : l));
    const q = await computeQuoteFor(w.db, { ...base(), lines });
    const owned = q.lines.find((l) => l.productId === w.products.ssd.id);
    expect(owned).toMatchObject({ customerOwned: true, purchasedByIp: false });
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM - w.products.ssd.price);
  });

  it("flags the returnability and the memory lines of each position", async () => {
    const q = await computeQuoteFor(w.db, { ...base(), lines: pcLines(w) });
    const by = (id: ProductId) => q.lines.find((l) => l.productId === id);
    expect(by(w.products.ssd.id)).toMatchObject({ returnable: "no", isRamOrSsd: true });
    expect(by(w.products.ram.id)).toMatchObject({ returnable: "yes", isRamOrSsd: true });
    expect(by(w.products.cpu.id)).toMatchObject({ returnable: "yes", isRamOrSsd: false, feeGroup: "pc" });
    expect(by(w.products.cpu.id)?.titleSnapshot).toBe("Ryzen 5 7600");
    expect(by(w.products.cpu.id)?.priceDate).toBe("2026-10-12");
  });

  it("adds the works of the owner: the scale of the mount, no purchase, and a licence outside the scale", async () => {
    const q = await computeQuoteFor(w.db, {
      ...base(),
      lines: pcLines(w),
      manualLines: [
        {
          title: "Cable management",
          categoryCode: "cable_mgmt",
          feeGroup: "mount",
          qty: 1,
          unitSum: 300_000,
          purchasedByIp: false,
        },
        { title: "Windows licence", categoryCode: "os_license", feeGroup: "outside_scale", qty: 1, unitSum: 1_500_000 },
      ],
    });
    expect(q.totals.outsideScaleSum).toBe(1_500_000);
    expect(q.totals.fee.parts.map((p) => p.group).sort()).toEqual(["mount", "pc"]);
    expect(q.totals.fee.total).toBe(1_777_500 + 45_000);
    // The licence is bought by the sole proprietor, the cable work is not: only the licence enters the limit.
    expect(q.totals.purchaseLimit).toBeGreaterThan(PC_COMPONENTS_SUM + 1_500_000);
  });

  it("refuses a manual line with a wrong sum, category or group", async () => {
    const bad = (m: object) =>
      computeQuoteFor(w.db, {
        ...base(),
        lines: [],
        manualLines: [{ title: "x", categoryCode: "decor", feeGroup: "outside_scale", qty: 1, unitSum: 1, ...m }],
      });
    await expect(bad({ unitSum: 1.5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ unitSum: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ qty: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ categoryCode: "teapot" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ feeGroup: "free" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ title: " " })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ unitSum: 1_000_000_000_001 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("checks the compatibility of a PC: a complete mid-range build is not refused", async () => {
    const q = await computeQuoteFor(w.db, { ...base(), lines: pcLines(w), tasks: ["gaming"] });
    expect(q.compatVerdict).not.toBe("block");
    expect(q.compat?.checkedRules.length).toBeGreaterThan(5);
  });

  it("passes the verdict 'block' of an impossible build on", async () => {
    const tiny = await catalog.createProduct(w.db, {
      slug: "case-tiny",
      categoryCode: "case",
      brand: "Tiny",
      model: "ITX-box",
      specs: {
        boards: ["Mini-ITX"],
        gpuMaxLenMm: 100,
        gpuMaxLenWithFrontRadMm: 90,
        coolerMaxHeightMm: 60,
        radiators: [],
        psuFF: ["SFX"],
        psuMaxLenMm: 100,
        expansionSlots: 2,
        fanMounts: 1,
        fansIncluded: 1,
        dimsMm: { w: 100, d: 200, h: 200 },
      },
      status: "verified",
    });
    await w.db.insert(marketPrices).values({
      productId: tiny,
      asOf: "2026-10-12",
      medianSum: 500_000,
      fromSum: 500_000,
      minSum: 500_000,
      maxSum: 500_000,
      offersN: 5,
      vendorsN: 5,
      maxAgeDays: 1,
      confidence: "high",
    });
    const lines = pcLines(w).map((l) =>
      l.productId === w.products.case.id ? { ...l, productId: tiny as ProductId } : l,
    );
    const q = await computeQuoteFor(w.db, { ...base(), lines });
    expect(q.compatVerdict).toBe("block");
  });

  it("does not run the PC rules over a desk setup: the verdict is 'incomplete' without a plan", async () => {
    const q = await computeQuoteFor(w.db, {
      ...base(),
      kind: "setup",
      lines: [],
      manualLines: [{ title: "Desk", categoryCode: "desk", feeGroup: "mount", qty: 1, unitSum: 14_000_000 }],
    });
    expect(q.compatVerdict).toBe("incomplete");
    expect(q.compat).toBeNull();
  });

  it("refuses an unknown product, a product that is not verified and a position without any price", async () => {
    await expect(
      computeQuoteFor(w.db, { ...base(), lines: [{ productId: "ghost" as ProductId, qty: 1 }] }),
    ).rejects.toMatchObject({ issues: [{ code: "unknown_product" }] });
    const draft = await catalog.createProduct(w.db, {
      slug: "ram-draft",
      categoryCode: "ram",
      brand: "Draft",
      model: "RAM",
      specs: {},
    });
    await expect(
      computeQuoteFor(w.db, { ...base(), lines: [{ productId: draft as ProductId, qty: 1 }] }),
    ).rejects.toMatchObject({ issues: [{ code: "unknown_product" }] });
    const noPrice = await catalog.createProduct(w.db, {
      slug: "fan-noprice",
      categoryCode: "fan",
      brand: "NoPrice",
      model: "Fan",
      specs: { sizeMm: 120, count: 1, conn: "4pin", argb: false },
      status: "verified",
    });
    await expect(
      computeQuoteFor(w.db, { ...base(), lines: [{ productId: noPrice as ProductId, qty: 1 }] }),
    ).rejects.toMatchObject({ issues: [{ code: "no_price" }] });
  });

  it("refuses two processors with a validation error, not a RangeError of the compatibility engine", async () => {
    const lines = [...pcLines(w), { productId: w.products.cpu.id, qty: 1 }];
    await expect(computeQuoteFor(w.db, { ...base(), lines })).rejects.toMatchObject({
      name: "ValidationError",
      issues: [{ code: "single_part_violated" }],
    });
  });

  it("reads the settings of the owner: a changed advance changes the split of the fee", async () => {
    const fee = await ops.getSetting(w.db, "money.fee_settings");
    expect(fee).toBeNull();
    const { DEFAULT_FEE_SETTINGS } = await import("@nivel/domain/fee");
    await ops.setSetting(w.db, "money.fee_settings", { ...DEFAULT_FEE_SETTINGS, advanceBp: 4000 }, "test");
    try {
      const q = await computeQuoteFor(w.db, { ...base(), lines: pcLines(w) });
      expect(q.totals.advance).toBe(Math.floor((q.totals.fee.total * 4000) / 10_000));
      expect(q.settings.advanceBp).toBe(4000);
    } finally {
      await ops.setSetting(w.db, "money.fee_settings", DEFAULT_FEE_SETTINGS, "test");
    }
  });

  it("works for the site role too: the catalog and the prices are public to it", async () => {
    const q = await computeQuoteFor(w.web.db, { ...base(), lines: pcLines(w) });
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM);
  });

  it("remembers the prices it used", async () => {
    const q = await computeQuoteFor(w.db, { ...base(), lines: pcLines(w) });
    expect(q.priceSnapshot[w.products.gpu.id]).toEqual({
      asOf: "2026-10-12",
      median: 3_600_000,
      from: 3_600_000,
      confidence: "high",
    });
  });
});
