import { describe, expect, it } from "vitest";
import { feeChart } from "./fee-chart.ts";
import { DEFAULT_FEE_SCALE } from "./fee-scale.ts";

describe("feeChart: the chart of the fee on estimates of 5 to 60 million", () => {
  const wide = feeChart(DEFAULT_FEE_SCALE, false);
  const narrow = feeChart(DEFAULT_FEE_SCALE, true);

  it("has the size of the prototype for a computer and for a phone", () => {
    expect([wide.width, wide.height]).toEqual([640, 280]);
    expect([narrow.width, narrow.height]).toEqual([360, 250]);
  });

  it("starts the line at 5 million and ends it at 60 million, inside the frame", () => {
    for (const c of [wide, narrow]) {
      const pts = c.path.match(/[ML]-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?/g) ?? [];
      expect(pts).toHaveLength(221);
      const [x0, y0] = (pts[0] as string).slice(1).split(" ").map(Number) as [number, number];
      const [x1, y1] = (pts.at(-1) as string).slice(1).split(" ").map(Number) as [number, number];
      expect(x0).toBeCloseTo(c.plot.left, 1);
      expect(x1).toBeCloseTo(c.width - c.plot.right, 1);
      for (const y of [y0, y1]) {
        expect(y).toBeGreaterThanOrEqual(c.plot.top);
        expect(y).toBeLessThanOrEqual(c.height - c.plot.bottom);
      }
      expect(y1).toBeLessThan(y0); // the fee grows with the estimate
    }
  });

  it("marks the stretch where the minimum applies, from the threshold to 30 million", () => {
    const [from, to] = [wide.band.x, wide.band.x + wide.band.width];
    const unit = (wide.width - wide.plot.left - wide.plot.right) / 55;
    expect(from).toBeCloseTo(wide.plot.left + 15 * unit, 1);
    expect(to).toBeCloseTo(wide.plot.left + 25 * unit, 1);
  });

  it("puts a dot on the estimates of 10, 20, 40 and 60 million with the fee they have", () => {
    expect(wide.dots.map((d) => d.fee)).toEqual([1_500_000, 3_000_000, 4_000_000, 6_000_000]);
    expect(wide.dots.map((d) => d.base)).toEqual([10_000_000, 20_000_000, 40_000_000, 60_000_000]);
  });

  it("has a scale of 0 to 6 million of fee and the estimates 5, 10, 20, 30, 40, 50, 60", () => {
    expect(wide.yTicks.map((t) => t.label)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(wide.xTicks.map((t) => t.label)).toEqual(["5", "10", "20", "30", "40", "50", "60"]);
    expect(wide.yTicks[0]?.y).toBeGreaterThan(wide.yTicks[6]?.y ?? 0);
  });

  it("keeps the whole curve inside the frame also for a scale with a higher fee", () => {
    const c = feeChart({ ...DEFAULT_FEE_SCALE, pcHighRateBp: 1500, pcHighMinFee: 5_000_000 }, false);
    expect(Number(c.yTicks.at(-1)?.label)).toBeGreaterThanOrEqual(9);
    const ys = (c.path.match(/ (-?\d+(?:\.\d+)?)/g) ?? []).map((s) => Number(s));
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(c.plot.top - 0.1);
  });

  it("is all numbers with one decimal at most, so that the page does not grow with noise", () => {
    expect(wide.path).not.toMatch(/\.\d{2,}/);
  });
});
