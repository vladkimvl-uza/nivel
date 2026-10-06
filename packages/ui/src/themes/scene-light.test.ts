import { describe, expect, it } from "vitest";
import { sceneLight } from "./scene-light.ts";

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe("scene light, night set (exported for the 3D scene package, DESIGN_SYSTEM 5.3)", () => {
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

  it("has no day branch: no sun, no day/night pairs", () => {
    const text = JSON.stringify(sceneLight);
    expect(text).not.toMatch(/"day"/);
    expect(text).not.toMatch(/"night"/);
    expect(Object.keys(sceneLight)).not.toContain("sun");
    expect(Object.keys(sceneLight.colors)).not.toContain("sun");
  });

  it("runs on the work light and the lamp", () => {
    expect(sceneLight.work).toEqual({ step1: 4.2, step2to3: 6 });
    expect(sceneLight.lamp).toEqual({ base: 9, lite: 10 });
    expect(sceneLight.lampShadeEmissive).toBe(0.34);
    expect(sceneLight.bounceOfLamp).toBe(1.3);
    expect(sceneLight.screen).toBe(0.6);
    expect(sceneLight.room).toEqual({ step4: 0.9, final: 1.7, fill: 0.9 });
  });

  it("keeps the sky and the environment dark", () => {
    expect(sceneLight.hemisphere).toEqual({ base: 0.045, lite: 0.085, finalAdd: 0.1 });
    expect(sceneLight.environment).toEqual({ base: 0.025, final: 0.075 });
  });

  it("keeps the PC backlight a barely visible warm white (no RGB)", () => {
    expect(sceneLight.colors.pcLed).toBe("#FFE7C4");
    expect(sceneLight.pcLight.intensity).toEqual({ min: 0.05, max: 0.08 });
  });

  it("matches the exposure, fog, background and shadow map sizes of the night column", () => {
    expect(sceneLight.exposure).toBe(1.08);
    expect(sceneLight.fog).toEqual({ near: 3.2, far: 9 });
    expect(sceneLight.background).toEqual({ base: "#0E0C0B", final: "#17130F" });
    expect(sceneLight.shadowMap).toEqual({ full: 2048, lite: 1024 });
    expect(sceneLight.flicker).toEqual({ startMs: 0, endMs: 260, riseMs: 500 });
    expect(sceneLight.screenRadius).toBe(0.72);
  });
});
