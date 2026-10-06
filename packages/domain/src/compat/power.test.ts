import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { estimatePower } from "./index.ts";
import { build, makeProduct, pid, settings } from "./testkit.ts";

const S = settings();

describe("estimatePower: peak (block 28, 3.4)", () => {
  it("sums CPU max power, GPU TGP, 50 W base and 5 W per case fan", () => {
    const b = build(
      makeProduct("cpu", "cpu", { maxPowerW: 88 }),
      makeProduct("gpu", "gpu", { tgpW: 145 }),
      makeProduct("case", "case", { fansIncluded: 2 }),
    );
    expect(estimatePower(b.lines, b.catalog, S).peakW).toBe(88 + 145 + 50 + 2 * 5);
  });

  it("counts fans of the fan category by kit size and quantity", () => {
    const b = build(makeProduct("cpu", "cpu", { maxPowerW: 100 }), [makeProduct("fan", "fan", { count: 3 }), 2]);
    expect(estimatePower(b.lines, b.catalog, S).peakW).toBe(100 + 50 + 6 * 5);
  });

  it("adds the pump (15 W) and the radiator fans for an AIO", () => {
    const b = build(makeProduct("cpu", "cpu", { maxPowerW: 100 }), makeProduct("aio", "aio", { radMm: 360 }));
    expect(estimatePower(b.lines, b.catalog, S).peakW).toBe(100 + 50 + 15 + 3 * 5);
    const b240 = build(makeProduct("cpu", "cpu", { maxPowerW: 100 }), makeProduct("aio", "aio", { radMm: 240 }));
    expect(estimatePower(b240.lines, b240.catalog, S).peakW).toBe(100 + 50 + 15 + 2 * 5);
  });

  it("multiplies GPU power by quantity and takes constants from the settings", () => {
    const b = build([makeProduct("gpu", "gpu", { tgpW: 200 }), 2]);
    const s = settings({ baseW: 60, perFanW: 7, pumpW: 20 });
    expect(estimatePower(b.lines, b.catalog, s).peakW).toBe(400 + 60);
  });

  it("does not add the base load to a build without any PC component", () => {
    const b = build(makeProduct("monitor", "m"), makeProduct("desk", "d"));
    expect(estimatePower(b.lines, b.catalog, S)).toEqual({ peakW: 0, recommendedPsuW: 0 });
  });

  it("returns zeros for an empty build", () => {
    const b = build();
    expect(estimatePower(b.lines, b.catalog, S)).toEqual({ peakW: 0, recommendedPsuW: 0 });
  });

  it("treats unknown (null) values as 0: the estimate is a lower bound", () => {
    const b = build(makeProduct("cpu", "cpu", { maxPowerW: null }), makeProduct("gpu", "gpu", { tgpW: 100 }));
    expect(estimatePower(b.lines, b.catalog, S).peakW).toBe(150);
  });

  it("counts customer-owned parts: they draw power too", () => {
    const b = build(makeProduct("gpu", "gpu", { tgpW: 200 }));
    const lines = b.lines.map((l) => ({ ...l, customerOwned: true }));
    expect(estimatePower(lines, b.catalog, S).peakW).toBe(250);
  });

  it("ignores lines whose product is not in the catalog", () => {
    const b = build(makeProduct("gpu", "gpu", { tgpW: 200 }));
    const lines = [...b.lines, { productId: pid("ghost"), qty: 1 }];
    expect(estimatePower(lines, b.catalog, S).peakW).toBe(250);
  });
});

describe("estimatePower: recommended PSU", () => {
  const withGpu = (tgpW: number, vendor: number, cpuW = 65) =>
    build(
      makeProduct("cpu", "cpu", { maxPowerW: cpuW }),
      makeProduct("gpu", "gpu", { tgpW, vendorRecommendedPsuW: vendor }),
    );

  it("RTX 5070 (TGP 250 W, vendor 650 W) needs at least 650 W even for a weak CPU", () => {
    const b = withGpu(250, 650, 65);
    const p = estimatePower(b.lines, b.catalog, S);
    expect(p.peakW).toBe(65 + 250 + 50);
    expect(p.recommendedPsuW).toBeGreaterThanOrEqual(650);
    expect(p.recommendedPsuW).toBe(650);
  });

  it("RTX 5070 Ti keeps the vendor 750 W floor", () => {
    const b = withGpu(300, 750, 65);
    expect(estimatePower(b.lines, b.catalog, S).recommendedPsuW).toBe(750);
  });

  it("takes peak x 1.3 rounded up to the series when it is above the vendor figure", () => {
    const b = withGpu(350, 650, 100); // peak 500 -> 650 exactly
    expect(estimatePower(b.lines, b.catalog, S)).toMatchObject({ peakW: 500, recommendedPsuW: 650 });
    const b2 = withGpu(351, 650, 100); // peak 501 -> 651.3 -> 750
    expect(estimatePower(b2.lines, b2.catalog, S)).toMatchObject({ peakW: 501, recommendedPsuW: 750 });
  });

  it("is not fooled by binary floating point: 100 x 1.1 is 110.00000000000001 in JS but exactly 110 W", () => {
    expect(100 * 1.1).toBeGreaterThan(110); // the trap
    const b = build(makeProduct("cpu", "cpu", { maxPowerW: 50 })); // peak 100
    expect(
      estimatePower(b.lines, b.catalog, settings({ psuMultiplier: 1.1, psuSeriesW: [110, 200] })).recommendedPsuW,
    ).toBe(110);
  });

  it("rounds above the largest series entry up to 100 W", () => {
    const b = withGpu(900, 0, 100); // peak 1050 -> 1365 -> 1400
    expect(estimatePower(b.lines, b.catalog, S).recommendedPsuW).toBe(1400);
  });

  it("works with an unsorted series; with an empty series it rounds up to 100 W", () => {
    const b = withGpu(250, 0, 65); // peak 365 -> 474.5
    expect(estimatePower(b.lines, b.catalog, settings({ psuSeriesW: [750, 450, 600] })).recommendedPsuW).toBe(600);
    expect(estimatePower(b.lines, b.catalog, settings({ psuSeriesW: [] })).recommendedPsuW).toBe(500);
  });

  it("takes the strictest vendor figure among several cards", () => {
    const b = build(
      makeProduct("gpu", "a", { tgpW: 100, vendorRecommendedPsuW: 550 }),
      makeProduct("gpu", "b", { tgpW: 100, vendorRecommendedPsuW: 850 }),
    );
    expect(estimatePower(b.lines, b.catalog, S).recommendedPsuW).toBe(850);
  });
});

describe("estimatePower: selected PSU and headroom", () => {
  it("reports the headroom against the PSU rating: 420 W peak on 750 W is 44 %", () => {
    const b = build(
      makeProduct("cpu", "cpu", { maxPowerW: 100 }),
      makeProduct("gpu", "gpu", { tgpW: 270 }),
      makeProduct("psu", "psu", { watts: 750 }),
    );
    const p = estimatePower(b.lines, b.catalog, S);
    expect(p.peakW).toBe(420);
    expect(p.selectedPsuW).toBe(750);
    expect(p.headroomBp).toBe(4400);
  });

  it("floors the headroom to whole basis points", () => {
    const b = build(makeProduct("gpu", "gpu", { tgpW: 249 }), makeProduct("psu", "psu", { watts: 650 })); // peak 299
    expect(estimatePower(b.lines, b.catalog, S).headroomBp).toBe(Math.floor(((650 - 299) * 10_000) / 650));
  });

  it("clamps the headroom to 0 when the PSU is below the peak", () => {
    const b = build(makeProduct("gpu", "gpu", { tgpW: 600 }), makeProduct("psu", "psu", { watts: 550 }));
    expect(estimatePower(b.lines, b.catalog, S)).toMatchObject({ selectedPsuW: 550, headroomBp: 0 });
  });

  it("omits both fields without a PSU or when its wattage is unknown", () => {
    const noPsu = build(makeProduct("gpu", "gpu"));
    expect(Object.keys(estimatePower(noPsu.lines, noPsu.catalog, S)).sort()).toEqual(["peakW", "recommendedPsuW"]);
    const unknown = build(makeProduct("gpu", "gpu"), makeProduct("psu", "psu", { watts: null }));
    expect(Object.keys(estimatePower(unknown.lines, unknown.catalog, S)).sort()).toEqual(["peakW", "recommendedPsuW"]);
  });
});

describe("estimatePower: properties", () => {
  it("recommended PSU covers peak x 1.3 and the vendor figure; both grow with GPU power", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 0, max: 700 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 200 }),
        (cpuW, gpuW, vendor, extra) => {
          const mk = (g: number) =>
            build(
              makeProduct("cpu", "cpu", { maxPowerW: cpuW }),
              makeProduct("gpu", "gpu", { tgpW: g, vendorRecommendedPsuW: vendor }),
            );
          const a = mk(gpuW);
          const b = mk(gpuW + extra);
          const pa = estimatePower(a.lines, a.catalog, S);
          const pb = estimatePower(b.lines, b.catalog, S);
          expect(pa.recommendedPsuW).toBeGreaterThanOrEqual(Math.ceil(pa.peakW * 1.3 - 1e-9));
          expect(pa.recommendedPsuW).toBeGreaterThanOrEqual(vendor);
          expect(pb.peakW).toBeGreaterThanOrEqual(pa.peakW);
          expect(pb.recommendedPsuW).toBeGreaterThanOrEqual(pa.recommendedPsuW);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it("does not depend on the order of lines", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 }), (order) => {
        const parts = [
          makeProduct("cpu", "cpu"),
          makeProduct("gpu", "gpu"),
          makeProduct("case", "case"),
          makeProduct("psu", "psu"),
          makeProduct("aio", "aio"),
        ];
        const ordered = order.map((i) => parts[i] as (typeof parts)[number]);
        const a = build(...parts);
        const b = build(...ordered);
        expect(estimatePower(b.lines, b.catalog, S)).toEqual(estimatePower(a.lines, a.catalog, S));
      }),
      { numRuns: 50 },
    );
  }, 60_000);
});
