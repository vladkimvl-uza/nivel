import { describe, expect, it } from "vitest";
import { sceneLight } from "./scene-light.ts";

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe("scene light (exported for the 3D scene package, DESIGN_SYSTEM 5.3)", () => {
  it("has only warm colors: R > G > B for every light, R >= G >= B for backgrounds", () => {
    for (const [name, hex] of Object.entries(sceneLight.colors)) {
      const [r, g, b] = rgb(hex);
      expect(r > g && g > b, `${name} ${hex}`).toBe(true);
    }
    for (const hex of Object.values(sceneLight.background)) {
      const [r, g, b] = rgb(hex);
      expect(r >= g && g >= b, hex).toBe(true);
    }
  });

  it("runs on the sun by day and on the work light and the lamp by night", () => {
    expect(sceneLight.day.sun.base).toBeGreaterThan(2);
    expect(sceneLight.day.sun.step4).toBeCloseTo(sceneLight.day.sun.base - 0.45, 10);
    expect(sceneLight.night.sun.base).toBe(0);
    expect(sceneLight.day.work).toEqual({ step1: 0, step2to3: 0 });
    expect(sceneLight.night.work).toEqual({ step1: 4.2, step2to3: 6 });
    expect(sceneLight.night.lamp.base).toBeGreaterThan(sceneLight.day.lamp.base);
  });

  it("keeps the PC backlight a barely visible warm white (no RGB)", () => {
    expect(sceneLight.colors.pcLed).toBe("#FFE7C4");
    expect(sceneLight.pcLight.intensity).toEqual({ min: 0.05, max: 0.08 });
  });

  it("matches the exposure, fog and shadow map sizes of the table", () => {
    expect(sceneLight.exposure).toEqual({ day: 1, night: 1.08 });
    expect(sceneLight.fog).toEqual({ day: null, night: { near: 3.2, far: 9 } });
    expect(sceneLight.shadowMap).toEqual({ full: 2048, lite: 1024 });
  });

  it("is darker at night in sky and environment light, brighter in the lamp shade", () => {
    expect(sceneLight.night.hemisphere.base).toBeLessThan(sceneLight.day.hemisphere.base);
    expect(sceneLight.night.environment.base).toBeLessThan(sceneLight.day.environment.base);
    expect(sceneLight.night.lampShadeEmissive).toBeGreaterThan(sceneLight.day.lampShadeEmissive);
  });
});
