import { describe, expect, it } from "vitest";
import { PASSPORT_SERIES, series } from "./temp-series.ts";

describe("series: the sensor log of the sample passport", () => {
  it("has a point every ten minutes for eight hours, from the idle temperature", () => {
    const s = series(39, 76.5, 7);
    expect(s).toHaveLength(49);
    expect(s[0]).toBe(39);
  });

  it("climbs to the load temperature in the first twenty minutes and holds it", () => {
    const s = series(39, 76.5, 7);
    expect(s[2]).toBeGreaterThan(70);
    for (const v of s.slice(2)) {
      expect(v).toBeGreaterThan(70);
      expect(v).toBeLessThan(79);
    }
  });

  it("is the same every time: the page must not change between two renders", () => {
    expect(series(39, 76.5, 7)).toEqual(series(39, 76.5, 7));
    expect(series(39, 76.5, 7)).not.toEqual(series(39, 76.5, 8));
  });

  it("writes one decimal", () => {
    for (const v of series(36, 70.5, 3)) expect(Math.round(v * 10) / 10).toBe(v);
  });
});

describe("PASSPORT_SERIES", () => {
  it("shows the processor at 77 °C and the video card at 71 °C at most, as the passport says", () => {
    const [cpu, gpu] = PASSPORT_SERIES;
    expect(cpu?.id).toBe("cpu");
    expect(Math.round(Math.max(...(cpu?.values ?? [])))).toBe(77);
    expect(gpu?.id).toBe("gpu");
    expect(Math.round(Math.max(...(gpu?.values ?? [])))).toBe(71);
    expect(cpu?.max).toBe(77);
    expect(gpu?.max).toBe(71);
  });

  it("knows where the peak is, for the marker on the chart", () => {
    for (const s of PASSPORT_SERIES) expect(s.values[s.peakAt]).toBe(Math.max(...s.values));
  });
});
