import { describe, expect, it } from "vitest";
import type { ProductId } from "../catalog/types.ts";
import { computeMarketPrice, DEFAULT_MARKET_POLICY, type ExcludeReason, type MarketPolicy } from "./index.ts";
import { HOUR_MS, NOW, obs, offers } from "./testkit.ts";
import type { PriceObservation } from "./types.ts";

const P = DEFAULT_MARKET_POLICY;
const compute = (o: readonly PriceObservation[], policy: MarketPolicy = P) => computeMarketPrice(o, NOW, policy);
const policy = (over: Partial<MarketPolicy>): MarketPolicy => ({ ...P, ...over });

describe("acceptance: RX 550 for 39 million is cut off", () => {
  it("3-5 offers: outside the 0.6-1.6 band of the median", () => {
    const r = compute(offers([1_100_000, 1_150_000, 1_200_000, 39_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o4", reason: "outlier" }]);
    expect(r.median).toBe(1_150_000);
    expect(r.max).toBe(1_200_000);
    expect(r.vendors).toBe(3);
    expect(r.flags).toEqual(["outlier_removed"]);
  });

  it("6+ offers: MAD rule 3.5 x 1.4826 x MAD (high outlier)", () => {
    // median 1 170 000, MAD 50 000 -> limit 259 455: 80 000 stays, 37 830 000 goes.
    const r = compute(offers([1_100_000, 1_120_000, 1_150_000, 1_170_000, 1_200_000, 1_250_000, 39_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o7", reason: "outlier" }]);
    expect(r.median).toBe(1_160_000);
    expect(r.min).toBe(1_100_000);
    expect(r.max).toBe(1_250_000);
    expect(r.vendors).toBe(6);
    expect(r.confidence).toBe("high");
    expect(r.flags).toEqual(["outlier_removed"]);
  });

  it("6+ offers: MAD rule removes a low outlier too", () => {
    const r = compute(offers([1_100_000, 1_120_000, 1_150_000, 1_170_000, 1_200_000, 1_250_000, 300_000]));
    expect(r.excluded).toEqual([{ observationId: "o7", reason: "outlier" }]);
    expect(r.min).toBe(1_100_000);
  });

  it("MAD = 0 (many identical prices) falls back to the band, so the outlier still goes", () => {
    const r = compute(offers([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 39_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o7", reason: "outlier" }]);
    expect(r.median).toBe(1_000_000);
    expect(r.max).toBe(1_000_000);
  });

  it("MAD = 0 fallback keeps prices inside the band", () => {
    const r = compute(offers([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_500_000]));
    expect(r.excluded).toEqual([]);
    expect(r.max).toBe(1_500_000);
  });

  it("MAD rule works at the boundary of 6 offers (5 offers use the band)", () => {
    const five = compute(offers([1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_900_000]));
    // 5 offers: median 1 200 000, band up to 1 920 000 -> 1 900 000 stays.
    expect(five.excluded).toEqual([]);
    const six = compute(offers([1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000, 1_900_000]));
    // 6 offers: median 1 250 000, MAD 150 000 -> limit 778 365; 1 900 000 is 650 000 away -> stays.
    expect(six.excluded).toEqual([]);
    const sixFar = compute(offers([1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000, 3_000_000]));
    // median 1 250 000, deviations 250/150/50/50/150/1750 -> MAD 150 000, limit 778 365 -> 3 000 000 goes.
    expect(sixFar.excluded).toEqual([{ observationId: "o6", reason: "outlier" }]);
  });
});

describe("acceptance: vendors and confidence", () => {
  it("3 vendors: median, confidence medium", () => {
    const r = compute(offers([11_000_000, 11_400_000, 11_800_000]));
    expect(r.median).toBe(11_400_000);
    expect(r.from).toBe(11_000_000);
    expect(r.vendors).toBe(3);
    expect(r.confidence).toBe("medium");
  });

  it("2 vendors: no median, confidence low, only the 'from' price", () => {
    const r = compute(offers([11_400_000, 11_000_000]));
    expect(r.median).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.from).toBe(11_000_000);
    expect(r.min).toBe(11_000_000);
    expect(r.max).toBe(11_400_000);
    expect(r.vendors).toBe(2);
  });

  it("2 vendors: nothing is trimmed (a sample this small cannot judge outliers)", () => {
    const r = compute(offers([1_000_000, 39_000_000]));
    expect(r.excluded).toEqual([]);
    expect(r.flags).toEqual([]);
  });

  it("an outlier cut from 3 offers leaves 2 vendors: low, no median", () => {
    const r = compute(offers([11_000_000, 11_500_000, 39_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o3", reason: "outlier" }]);
    expect(r.median).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.from).toBe(11_000_000);
    expect(r.flags).toEqual(["outlier_removed"]);
  });

  it("5 vendors, data up to 3 days old: high", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_500_000, 11_600_000, 11_800_000], { ageHours: 72 }));
    expect(r.confidence).toBe("high");
    expect(r.maxAgeDays).toBe(3);
    expect(r.median).toBe(11_500_000);
    expect(r.offers).toBe(5);
  });

  it("5 vendors but data 3 days and an hour old: medium", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_500_000, 11_600_000, 11_800_000], { ageHours: 73 }));
    expect(r.confidence).toBe("medium");
    expect(r.maxAgeDays).toBe(4);
  });

  it("4 vendors with fresh data: medium", () => {
    expect(compute(offers([11_000_000, 11_200_000, 11_500_000, 11_600_000], { ageHours: 1 })).confidence).toBe(
      "medium",
    );
  });

  it("5 vendors, data 5 days old: medium", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_500_000, 11_600_000, 11_800_000], { ageHours: 120 }));
    expect(r.confidence).toBe("medium");
    expect(r.maxAgeDays).toBe(5);
  });

  it("3 vendors with data exactly 7 days old: still fresh, medium", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_500_000], { ageHours: 168 }));
    expect(r.confidence).toBe("medium");
    expect(r.maxAgeDays).toBe(7);
    expect(r.median).toBe(11_200_000);
  });

  it("data older than 7 days is not used: low, no median", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_500_000], { ageHours: 169 }));
    expect(r.confidence).toBe("low");
    expect(r.median).toBeNull();
    expect(r.excluded.map((e) => e.reason)).toEqual(["stale", "stale", "stale"]);
  });

  it("maxAgeDays counts only observations that stayed in the calculation", () => {
    const r = compute([
      ...offers([11_000_000, 11_200_000, 11_500_000, 11_600_000, 11_800_000], { ageHours: 24 }),
      obs("old", "v-old", 11_300_000, { ageHours: 24 * 10 }),
    ]);
    expect(r.maxAgeDays).toBe(1);
    expect(r.confidence).toBe("high");
  });

  it("maxAgeDays is the oldest kept observation", () => {
    const r = compute([
      obs("a", "va", 11_000_000, { ageHours: 24 }),
      obs("b", "vb", 11_200_000, { ageHours: 96 }),
      obs("c", "vc", 11_400_000, { ageHours: 48 }),
    ]);
    expect(r.maxAgeDays).toBe(4);
  });

  it("a longer window (furniture, 30 days) keeps old data and gives medium", () => {
    const r = compute(
      offers([5_000_000, 5_200_000, 5_400_000, 5_600_000], { ageHours: 480 }),
      policy({ freshnessDays: 30 }),
    );
    expect(r.confidence).toBe("medium");
    expect(r.maxAgeDays).toBe(20);
  });

  it("the high threshold comes from the policy", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_400_000]), policy({ high: { vendors: 3, maxAgeDays: 1 } }));
    expect(r.confidence).toBe("high");
  });

  it("minVendors comes from the policy", () => {
    expect(compute(offers([11_000_000, 11_200_000, 11_400_000]), policy({ minVendors: 4 })).median).toBeNull();
    const one = compute(offers([11_000_000]), policy({ minVendors: 1 }));
    expect(one.median).toBe(11_000_000);
    expect(one.confidence).toBe("medium");
  });
});

describe("acceptance: one price per vendor", () => {
  it("keeps the cheapest offer of a vendor, the others are duplicate_vendor", () => {
    const r = compute([
      obs("a1", "v1", 10_000_000),
      obs("a2", "v1", 9_500_000),
      obs("a3", "v1", 9_800_000),
      obs("b", "v2", 10_200_000),
      obs("c", "v3", 10_400_000),
    ]);
    expect(r.excluded).toEqual([
      { observationId: "a1", reason: "duplicate_vendor" },
      { observationId: "a3", reason: "duplicate_vendor" },
    ]);
    expect(r.from).toBe(9_500_000);
    expect(r.median).toBe(10_200_000);
    expect(r.vendors).toBe(3);
    expect(r.offers).toBe(3);
  });

  it("three offers of one vendor are one vendor: low, no median", () => {
    const r = compute([obs("a", "v1", 10_000_000), obs("b", "v1", 10_100_000), obs("c", "v1", 10_200_000)]);
    expect(r.vendors).toBe(1);
    expect(r.median).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.from).toBe(10_000_000);
  });

  it("a stale cheaper offer does not displace the vendor's fresh price", () => {
    const r = compute([
      obs("old", "v1", 8_000_000, { ageHours: 240 }),
      obs("new", "v1", 9_500_000),
      obs("b", "v2", 10_200_000),
      obs("c", "v3", 10_400_000),
    ]);
    expect(r.excluded).toEqual([{ observationId: "old", reason: "stale" }]);
    expect(r.from).toBe(9_500_000);
  });

  it("equal prices of one vendor: the fresher observation stays, then the smaller id", () => {
    const fresher = compute([
      obs("x1", "v1", 9_000_000, { ageHours: 48 }),
      obs("x2", "v1", 9_000_000, { ageHours: 24 }),
      obs("b", "v2", 10_200_000),
      obs("c", "v3", 10_400_000),
    ]);
    expect(fresher.excluded).toEqual([{ observationId: "x1", reason: "duplicate_vendor" }]);
    const byId = compute([
      obs("x2", "v1", 9_000_000),
      obs("x1", "v1", 9_000_000),
      obs("b", "v2", 10_200_000),
      obs("c", "v3", 10_400_000),
    ]);
    expect(byId.excluded).toEqual([{ observationId: "x2", reason: "duplicate_vendor" }]);
  });
});

describe("acceptance: currency error", () => {
  it("dollars typed into the sum field are excluded as currency_error, not as outlier", () => {
    // median of four = 11 650 000; 11 000 x 1000 = 11 000 000 < median.
    const r = compute(offers([11_000, 11_500_000, 11_800_000, 12_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o1", reason: "currency_error" }]);
    expect(r.flags).toEqual(["currency_suspect"]);
    expect(r.median).toBe(11_800_000);
    expect(r.vendors).toBe(3);
  });

  it("price x ratio exactly equal to the median is not a currency error (it is caught as outlier)", () => {
    const r = compute(offers([11_650, 11_650_000, 11_650_000, 11_800_000, 12_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o1", reason: "outlier" }]);
    expect(r.flags).toEqual(["outlier_removed"]);
  });

  it("one sum below the boundary is a currency error", () => {
    const r = compute(offers([11_649, 11_650_000, 11_650_000, 11_800_000, 12_000_000]));
    expect(r.excluded).toEqual([{ observationId: "o1", reason: "currency_error" }]);
    expect(r.flags).toEqual(["currency_suspect"]);
  });

  it("the ratio comes from the policy", () => {
    // 500 000 x 20 = 10 000 000 < median 11 650 000 (with the default ratio 1000 it is only an outlier).
    const r = compute(offers([500_000, 11_500_000, 11_800_000, 12_000_000]), policy({ currencyErrorRatio: 20 }));
    expect(r.excluded).toEqual([{ observationId: "o1", reason: "currency_error" }]);
  });

  it("a currency error is removed before outlier trimming, so it does not shift the band", () => {
    const r = compute(offers([11_000, 11_500_000, 11_800_000, 12_000_000, 12_100_000, 12_200_000, 12_300_000]));
    expect(r.excluded).toEqual([{ observationId: "o1", reason: "currency_error" }]);
    expect(r.flags).toEqual(["currency_suspect"]);
  });
});

describe("filters of block 08, 5.2", () => {
  const good = offers([11_000_000, 11_200_000, 11_400_000]);
  const withBad = (over: Partial<PriceObservation> & { ageHours?: number }) =>
    compute([...good, obs("bad", "v-bad", 11_300_000, over)]);

  it.each<[string, Partial<PriceObservation> & { ageHours?: number }, ExcludeReason]>([
    ["used", { condition: "used" }, "used_or_refurb"],
    ["refurbished", { condition: "refurb" }, "used_or_refurb"],
    ["on order", { availability: "on_order" }, "not_in_stock"],
    ["preorder", { availability: "preorder" }, "not_in_stock"],
    ["ask availability", { availability: "ask" }, "not_in_stock"],
    ["'from' price", { isFromPrice: true }, "from_price"],
    ["private seller", { vendorKind: "private" }, "private_seller"],
    ["older than 7 days", { ageHours: 168.01 }, "stale"],
  ])("excludes %s", (_name, over, reason) => {
    const r = withBad(over);
    expect(r.excluded).toEqual([{ observationId: "bad", reason }]);
    expect(r.vendors).toBe(3);
    expect(r.median).toBe(11_200_000);
  });

  it.each<[string, Partial<PriceObservation> & { ageHours?: number }, ExcludeReason]>([
    ["used before not in stock", { condition: "used", availability: "on_order" }, "used_or_refurb"],
    ["used before stale", { condition: "used", ageHours: 500 }, "used_or_refurb"],
    ["not in stock before 'from'", { availability: "ask", isFromPrice: true }, "not_in_stock"],
    ["'from' before private", { isFromPrice: true, vendorKind: "private" }, "from_price"],
    ["private before stale", { vendorKind: "private", ageHours: 500 }, "private_seller"],
  ])("reason order: %s", (_name, over, reason) => {
    expect(withBad(over).excluded).toEqual([{ observationId: "bad", reason }]);
  });

  it("an observation exactly at the freshness limit is still fresh", () => {
    expect(withBad({ ageHours: 168 }).excluded).toEqual([]);
  });

  it("partners, shops and marketplace sellers all count", () => {
    const r = compute([
      obs("a", "v1", 11_000_000, { vendorKind: "partner" }),
      obs("b", "v2", 11_200_000, { vendorKind: "shop" }),
      obs("c", "v3", 11_400_000, { vendorKind: "marketplace_seller" }),
    ]);
    expect(r.vendors).toBe(3);
    expect(r.excluded).toEqual([]);
  });

  it("an excluded cheaper offer of a vendor does not displace the vendor's valid price", () => {
    const r = compute([
      obs("a-from", "v1", 5_000_000, { isFromPrice: true }),
      obs("a", "v1", 11_000_000),
      obs("b", "v2", 11_200_000),
      obs("c", "v3", 11_400_000),
    ]);
    expect(r.from).toBe(11_000_000);
    expect(r.excluded).toEqual([{ observationId: "a-from", reason: "from_price" }]);
  });

  it("the freshness window comes from the policy (GPU: 3 days)", () => {
    const o = offers([11_000_000, 11_200_000, 11_400_000], { ageHours: 96 });
    expect(compute(o, policy({ freshnessDays: 3 })).median).toBeNull();
    expect(compute(o, policy({ freshnessDays: 7 })).median).toBe(11_200_000);
  });

  it("a timestamp from the future counts as age 0", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_400_000], { ageHours: -5 }));
    expect(r.maxAgeDays).toBe(0);
    expect(r.median).toBe(11_200_000);
  });

  it("everything excluded: empty result, low confidence", () => {
    const r = compute(offers([11_000_000, 11_200_000], { vendorKind: "private" }));
    expect(r).toMatchObject({
      median: null,
      from: null,
      min: null,
      max: null,
      offers: 0,
      vendors: 0,
      maxAgeDays: 0,
      confidence: "low",
      flags: [],
    });
    expect(r.excluded).toHaveLength(2);
  });
});

describe("median", () => {
  it("odd count: the middle value", () => {
    expect(compute(offers([11_800_000, 11_000_000, 11_400_000])).median).toBe(11_400_000);
  });

  it("even count: mean of the two middle values, rounded up to a whole sum", () => {
    expect(compute(offers([1_000_001, 1_000_002, 1_000_003, 1_000_004])).median).toBe(1_000_003); // 1 000 002.5
    expect(compute(offers([1_000_000, 1_000_002, 1_000_004, 1_000_006])).median).toBe(1_000_003); // exact
  });

  it("does not overflow near the safe integer limit", () => {
    const big = Number.MAX_SAFE_INTEGER - 10;
    const r = compute(offers([big - 3, big - 2, big - 1, big]));
    expect(r.median).toBe(big - 1); // (big-2 + big-1)/2 = big-1.5 -> up
  });

  it("result sums are branded integers", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_400_000]));
    for (const v of [r.median, r.from, r.min, r.max]) expect(Number.isSafeInteger(v)).toBe(true);
  });
});

describe("same_price_cluster (block 08, 5.4: false independence)", () => {
  const flagsOf = (prices: number[]) => compute(offers(prices)).flags;

  it("five vendors with prices equal to hundreds of sums: flagged", () => {
    expect(flagsOf([10_000_000, 10_000_300, 10_000_900, 10_000_000, 10_000_500])).toEqual(["same_price_cluster"]);
  });
  it("three identical prices: flagged", () => {
    expect(flagsOf([10_000_000, 10_000_000, 10_000_000])).toEqual(["same_price_cluster"]);
  });
  it("fewer independent price levels than minVendors: flagged", () => {
    expect(flagsOf([10_000_000, 10_000_000, 11_000_000])).toEqual(["same_price_cluster"]);
  });
  it("three different price levels: not flagged", () => {
    expect(flagsOf([10_000_000, 10_100_000, 10_200_000])).toEqual([]);
    expect(flagsOf([10_000_000, 10_000_000, 10_000_000, 11_000_000, 12_000_000])).toEqual([]);
  });
  it("difference of 1000 sums is a separate level, 999 is the same", () => {
    expect(flagsOf([10_000_000, 10_001_000, 11_000_000])).toEqual([]);
    expect(flagsOf([10_000_000, 10_000_999, 11_000_000])).toEqual(["same_price_cluster"]);
  });
  it("chains are not merged: a level is measured from its lowest price", () => {
    // Steps of 800 sums: levels start at 0, 1600 and 3200 -> three levels. A merged chain would be one level.
    expect(flagsOf([10_000_000, 10_000_800, 10_001_600, 10_002_400, 10_003_200, 10_004_000])).toEqual([]);
  });
  it("two vendors with one price: not flagged (already low)", () => {
    expect(flagsOf([10_000_000, 10_000_000])).toEqual([]);
  });
  it("does not change the confidence", () => {
    expect(compute(offers([10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000])).confidence).toBe("high");
  });
});

describe("result shape and purity", () => {
  it("asOf is now (a copy), productId comes from the observations", () => {
    const r = compute(offers([11_000_000, 11_200_000, 11_400_000]));
    expect(r.asOf.getTime()).toBe(NOW.getTime());
    expect(r.asOf).not.toBe(NOW);
    expect(r.productId).toBe("prod-rtx-5070");
  });

  it("does not mutate frozen input", () => {
    const input = Object.freeze(offers([11_400_000, 11_000_000, 39_000_000, 11_200_000]).map((o) => Object.freeze(o)));
    expect(() => compute(input)).not.toThrow();
    expect(input.map((o) => o.id)).toEqual(["o1", "o2", "o3", "o4"]);
  });

  it("excluded entries are sorted by observation id regardless of the input order", () => {
    const a = obs("b2", "v1", 9_000_000, { condition: "used" });
    const b = obs("a1", "v2", 9_000_000, { isFromPrice: true });
    const c = obs("c3", "v3", 9_000_000, { vendorKind: "private" });
    const r = compute([c, a, b, ...offers([11_000_000, 11_200_000, 11_400_000])]);
    expect(r.excluded.map((e) => e.observationId)).toEqual(["a1", "b2", "c3"]);
  });

  it("every observation is either counted or excluded", () => {
    const input = [
      ...offers([11_000_000, 11_200_000, 11_400_000, 39_000_000]),
      obs("dup", "v1", 12_000_000),
      obs("used", "v9", 5_000_000, { condition: "used" }),
    ];
    const r = compute(input);
    expect(r.offers + r.excluded.length).toBe(input.length);
  });
});

describe("invalid input", () => {
  it("empty observation list: the product cannot be identified", () => {
    expect(() => compute([])).toThrow(RangeError);
  });

  it("observations of different products are a caller bug", () => {
    expect(() =>
      compute([...offers([11_000_000, 11_200_000]), obs("x", "vx", 11_000_000, { productId: "other" as ProductId })]),
    ).toThrow(RangeError);
  });

  it.each([0, -5, 1.5, Number.NaN])("rejects price %s", (price) => {
    expect(() =>
      compute([...offers([11_000_000, 11_200_000]), { ...obs("x", "vx", 1), priceSum: price as never }]),
    ).toThrow(RangeError);
  });

  it("rejects an invalid observation date and an invalid now", () => {
    expect(() => compute([obs("x", "vx", 11_000_000, { observedAt: new Date("nope") })])).toThrow(RangeError);
    expect(() => computeMarketPrice(offers([11_000_000]), new Date("nope"), P)).toThrow(RangeError);
  });

  it.each<[string, Partial<MarketPolicy>]>([
    ["freshnessDays 0", { freshnessDays: 0 }],
    ["freshnessDays NaN", { freshnessDays: Number.NaN }],
    ["minVendors 0", { minVendors: 0 }],
    ["minVendors 1.5", { minVendors: 1.5 }],
    ["band reversed", { smallSampleBand: [1.6, 0.6] }],
    ["band lower 0", { smallSampleBand: [0, 1.6] }],
    ["band NaN", { smallSampleBand: [0.6, Number.NaN] }],
    ["madK 0", { madK: 0 }],
    ["currency ratio 0", { currencyErrorRatio: 0 }],
    ["high.vendors 0", { high: { vendors: 0, maxAgeDays: 3 } }],
    ["high.maxAgeDays -1", { high: { vendors: 5, maxAgeDays: -1 } }],
  ])("rejects policy: %s", (_name, over) => {
    expect(() => compute(offers([11_000_000, 11_200_000, 11_400_000]), policy(over))).toThrow(RangeError);
  });
});

describe("time basis", () => {
  it("ages are measured in milliseconds from now, not by calendar day", () => {
    const edge = new Date(NOW.getTime() - 7 * 24 * HOUR_MS);
    const r = compute([
      obs("a", "v1", 11_000_000, { observedAt: edge }),
      obs("b", "v2", 11_200_000),
      obs("c", "v3", 11_400_000),
    ]);
    expect(r.excluded).toEqual([]);
    expect(r.maxAgeDays).toBe(7);
  });
});
