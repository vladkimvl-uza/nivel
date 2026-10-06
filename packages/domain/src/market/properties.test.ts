// Property tests (fast-check): order independence, one price per vendor, bookkeeping, exact currency arithmetic.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sum } from "../money/index.ts";
import { computeMarketPrice, convertToSum, DEFAULT_MARKET_POLICY } from "./index.ts";
import { HOUR_MS, NOW, obs } from "./testkit.ts";
import type { PriceObservation } from "./types.ts";

const price = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 5_000_000, max: 20_000_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 50_000 }) }, // dollars typed into sums and the like
  { weight: 1, arbitrary: fc.integer({ min: 30_000_000, max: 60_000_000 }) }, // RX 550 for 39 million
);

/** Arbitrary observation of one product; ids are assigned by the caller to keep them unique. */
const observation = fc.record({
  vendor: fc.integer({ min: 1, max: 8 }),
  priceSum: price,
  ageHours: fc.integer({ min: -3, max: 24 * 12 }),
  kind: fc.constantFrom(...(["partner", "shop", "marketplace_seller", "private"] as const)),
  availability: fc.constantFrom(...(["in_stock", "in_stock", "in_stock", "on_order", "preorder", "ask"] as const)),
  condition: fc.constantFrom(...(["new", "new", "new", "refurb", "used"] as const)),
  isFromPrice: fc.boolean(),
});

const observations = fc.array(observation, { minLength: 1, maxLength: 30 }).map((rows) =>
  rows.map((r, i) =>
    obs(`o${String(i).padStart(3, "0")}`, `v${String(r.vendor)}`, r.priceSum, {
      ageHours: r.ageHours,
      vendorKind: r.kind,
      availability: r.availability,
      condition: r.condition,
      isFromPrice: r.isFromPrice,
    }),
  ),
);

/** Only offers that pass every eligibility filter: fresh, new, in stock, no "from", no private sellers. */
const eligibleObservations = fc
  .array(
    fc.record({ vendor: fc.integer({ min: 1, max: 8 }), priceSum: price, ageHours: fc.integer({ min: 0, max: 168 }) }),
    {
      minLength: 1,
      maxLength: 30,
    },
  )
  .map((rows) =>
    rows.map((r, i) =>
      obs(`o${String(i).padStart(3, "0")}`, `v${String(r.vendor)}`, r.priceSum, { ageHours: r.ageHours }),
    ),
  );

const compute = (o: readonly PriceObservation[]) => computeMarketPrice(o, NOW, DEFAULT_MARKET_POLICY);
const runs = { numRuns: 300 };

describe("computeMarketPrice properties", () => {
  it("the whole result does not depend on the order of observations (median included)", () => {
    fc.assert(
      fc.property(
        observations.chain((list) =>
          fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length })),
        ),
        ([list, shuffled]) => {
          expect(compute(shuffled)).toEqual(compute(list));
        },
      ),
      runs,
    );
  });

  it("one price per vendor: at most one counted observation per vendorId", () => {
    fc.assert(
      fc.property(observations, (list) => {
        const r = compute(list);
        const excluded = new Set(r.excluded.map((e) => e.observationId));
        const kept = list.filter((o) => !excluded.has(o.id));
        const vendors = kept.map((o) => o.vendorId);
        expect(new Set(vendors).size).toBe(vendors.length);
        expect(r.vendors).toBe(vendors.length);
        expect(r.offers).toBe(kept.length);
      }),
      runs,
    );
  });

  it("the counted price of a vendor is the lowest of its eligible prices", () => {
    fc.assert(
      fc.property(eligibleObservations, (list) => {
        const r = compute(list);
        const excluded = new Set(r.excluded.map((e) => e.observationId));
        for (const o of list) {
          if (excluded.has(o.id)) continue;
          const cheapest = Math.min(...list.filter((x) => x.vendorId === o.vendorId).map((x) => x.priceSum));
          expect(o.priceSum).toBe(cheapest);
        }
      }),
      runs,
    );
  });

  it("an extra, not cheaper offer of an existing vendor changes nothing but the excluded list", () => {
    fc.assert(
      fc.property(eligibleObservations, fc.nat(100), fc.integer({ min: 1, max: 1_000_000 }), (list, pick, extra) => {
        const base = list[pick % list.length] as PriceObservation;
        const vendorMin = Math.min(...list.filter((x) => x.vendorId === base.vendorId).map((x) => x.priceSum));
        const dup = obs("zzz", base.vendorId, vendorMin + extra);
        const before = compute(list);
        const after = compute([...list, dup]);
        expect({ ...after, excluded: [] }).toEqual({ ...before, excluded: [] });
        expect(after.excluded.some((e) => e.observationId === "zzz" && e.reason === "duplicate_vendor")).toBe(true);
      }),
      runs,
    );
  });

  it("bookkeeping: every observation is counted or excluded exactly once", () => {
    fc.assert(
      fc.property(observations, (list) => {
        const r = compute(list);
        expect(r.offers + r.excluded.length).toBe(list.length);
        const ids = r.excluded.map((e) => e.observationId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      runs,
    );
  });

  it("median and range are consistent", () => {
    fc.assert(
      fc.property(observations, (list) => {
        const r = compute(list);
        expect(r.from).toBe(r.min);
        if (r.vendors === 0) {
          expect([r.median, r.min, r.max]).toEqual([null, null, null]);
          expect(r.confidence).toBe("low");
          return;
        }
        expect(r.min as number).toBeLessThanOrEqual(r.max as number);
        if (r.vendors < DEFAULT_MARKET_POLICY.minVendors) {
          expect(r.median).toBeNull();
          expect(r.confidence).toBe("low");
        } else {
          expect(r.median).not.toBeNull();
          expect(r.median as number).toBeGreaterThanOrEqual(r.min as number);
          expect(r.median as number).toBeLessThanOrEqual(r.max as number);
          expect(r.confidence).not.toBe("low");
          expect(Number.isSafeInteger(r.median)).toBe(true);
        }
      }),
      runs,
    );
  });

  it("every counted observation is fresh and passes the filters of block 08, 5.2", () => {
    fc.assert(
      fc.property(observations, (list) => {
        const r = compute(list);
        const excluded = new Set(r.excluded.map((e) => e.observationId));
        for (const o of list.filter((x) => !excluded.has(x.id))) {
          expect(o.condition).toBe("new");
          expect(o.availability).toBe("in_stock");
          expect(o.isFromPrice).toBe(false);
          expect(o.vendorKind).not.toBe("private");
          expect(NOW.getTime() - o.observedAt.getTime()).toBeLessThanOrEqual(7 * 24 * HOUR_MS);
        }
        expect(r.maxAgeDays).toBeLessThanOrEqual(7);
      }),
      runs,
    );
  });
});

describe("convertToSum properties", () => {
  const digits = (min: number, max: number) => fc.stringMatching(new RegExp(`^[0-9]{${String(min)},${String(max)}}$`));

  /** Reference: scaled integer arithmetic done independently of the implementation (cents of cents). */
  function reference(
    amountInt: bigint,
    amountFrac: string,
    rateInt: bigint,
    rateFrac: string,
    nominal: bigint,
  ): bigint {
    const a = BigInt(`${amountInt}${amountFrac}`);
    const r = BigInt(`${rateInt}${rateFrac}`);
    const scale = 10n ** BigInt(amountFrac.length + rateFrac.length);
    const num = a * r;
    const den = scale * nominal;
    return (num * 2n + den) / (2n * den); // half-up for non-negative values
  }

  it("matches exact decimal arithmetic for any amount and rate", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        digits(0, 4),
        fc.bigInt({ min: 1n, max: 100_000n }),
        digits(0, 4),
        fc.integer({ min: 1, max: 100 }),
        (ai, af, ri, rf, nominal) => {
          const amount = af === "" ? `${ai}` : `${ai}.${af}`;
          const rate = rf === "" ? `${ri}` : `${ri}.${rf}`;
          const got = convertToSum(amount, { ccy: "USD", rate, nominal, effectiveDate: "2026-10-05" });
          expect(BigInt(got)).toBe(reference(ai, af, ri, rf, BigInt(nominal)));
        },
      ),
      runs,
    );
  });

  it("is monotonic in the amount", () => {
    fc.assert(
      fc.property(fc.nat(1_000_000), fc.nat(1_000_000), (x, y) => {
        const fx = { ccy: "USD" as const, rate: "11772.95", nominal: 1, effectiveDate: "2026-10-05" };
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        expect(convertToSum(String(lo), fx)).toBeLessThanOrEqual(convertToSum(String(hi), fx));
      }),
      runs,
    );
  });

  it("whole amount at a whole rate is the plain product", () => {
    fc.assert(
      fc.property(fc.nat(100_000), fc.integer({ min: 1, max: 100_000 }), (amount, rate) => {
        const got = convertToSum(String(amount), {
          ccy: "RUB",
          rate: String(rate),
          nominal: 1,
          effectiveDate: "2026-10-05",
        });
        expect(got).toBe(sum(amount * rate));
      }),
      runs,
    );
  });
});
