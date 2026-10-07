import { describe, expect, it } from "vitest";
import { buildSiteConfig } from "./config.ts";

const input = {
  mediaBase: "/media",
  locale: "uz" as const,
  reduced: false,
  labels: { a: "b" },
  stepNames: ["01 Tanlov", "02 Xarid", "03 Yigʻish va sinov", "04 Setap"],
  stepNow: "{n} / 04 · {name}",
  receiptSums: ["0", "1"],
  refund: "140 000 soʻm",
  motion: { on: "Animatsiyani yoqish", off: "Animatsiyasiz" },
};

describe("buildSiteConfig", () => {
  const c = buildSiteConfig(input);

  it("names the montage of the first screen for each size", () => {
    expect(c.hero.video).toEqual({
      m: "/media/nivel-night-brand-m.mp4",
      "1280": "/media/nivel-night-brand-1280.mp4",
      "1920": "/media/nivel-night-brand-1920.mp4",
    });
  });

  it("names four posters for each size, in the order of the steps", () => {
    expect(c.hero.posters["1280"]).toEqual([
      "/media/posters/step01-brand-1280.webp",
      "/media/posters/step02-brand-1280.webp",
      "/media/posters/step03-brand-1280.webp",
      "/media/posters/step04-brand-1280.webp",
    ]);
    expect(c.hero.posters.m[3]).toBe("/media/posters/step04-brand-m.webp");
    expect(c.hero.posters["1920"]).toHaveLength(4);
  });

  it("names the stills and the clips of the stages of the background for a computer (d) and a phone (m)", () => {
    expect(c.bg.stills.k).toEqual({ d: "/media/bg/k-d.webp", m: "/media/bg/k-m.webp" });
    expect(c.bg.stills.c.d).toBe("/media/bg/c-d.webp");
    expect(c.bg.clips.x).toEqual({ d: "/media/bg/x-d.mp4", m: "/media/bg/x-m.mp4" });
    expect(Object.keys(c.bg.clips)).toEqual(["x", "y", "t"]);
    expect(c.bg.grain).toBe("/media/bg/grain.webp");
  });

  it("follows the base of the media", () => {
    const other = buildSiteConfig({ ...input, mediaBase: "https://cdn.example/m" });
    expect(other.bg.clips.t.d).toBe("https://cdn.example/m/bg/t-d.mp4");
  });

  it("carries the texts and the state the page was served in", () => {
    expect(c.locale).toBe("uz");
    expect(c.reduced).toBe(false);
    expect(c.bg.labels).toEqual({ a: "b" });
    expect(c.hero.stepNow).toBe("{n} / 04 · {name}");
    expect(c.motion.off).toBe("Animatsiyasiz");
    expect(c.bg.refund).toBe("140 000 soʻm");
    expect(c.bg.receiptSums).toEqual(["0", "1"]);
    expect(buildSiteConfig({ ...input, reduced: true }).reduced).toBe(true);
  });
});
