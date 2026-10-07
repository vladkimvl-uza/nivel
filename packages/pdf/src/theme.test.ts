import { brand, compositeOver, contrastRatio, fontFaces, fontFile, parseColor, themeTokens } from "@nivel/ui";
import { describe, expect, it } from "vitest";
import { FAMILY, palette, textColors } from "./theme.ts";

const rgb = (hex: string) => parseColor(hex);

describe("the palette of the documents (decision R-17, nivel-1 on paper)", () => {
  it("takes the brand colors from the tokens of the design system and invents none", () => {
    expect(palette.paper).toBe(brand.paper);
    expect(palette.asphalt).toBe(brand.asphalt);
    expect(palette.signal).toBe(brand.signal);
    expect(palette.paper).toBe("#F1EFEA");
    expect(palette.stamp).toBe(themeTokens.night.stamp);
    expect(palette.minus).toBe(themeTokens.night.minus);
    expect(palette.ink2).toBe(themeTokens.night.docInk2);
  });

  it("gives plain #rrggbb colors: the renderer does not read rgba()", () => {
    for (const [name, value] of Object.entries(palette)) expect(value, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("lays the thin line of the design (docLine) over the paper as an opaque color", () => {
    const expected = compositeOver(rgb(themeTokens.night.docLine), rgb(brand.paper));
    const got = rgb(palette.line);
    expect(Math.abs(got.r - expected.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(got.g - expected.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(got.b - expected.b)).toBeLessThanOrEqual(1);
  });

  it("keeps every text color readable on the paper (WCAG AA, 4.5:1)", () => {
    expect(textColors.length).toBeGreaterThanOrEqual(4);
    for (const name of textColors) {
      const ratio = contrastRatio(rgb(palette[name]), rgb(palette.paper));
      expect(ratio, `${name} ${palette[name]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("has no color of the anti-list (blue, violet, teal): every channel order stays warm", () => {
    for (const [name, value] of Object.entries(palette)) {
      const c = rgb(value);
      expect(c.b, `${name} is not bluer than red`).toBeLessThanOrEqual(c.r + 1);
    }
  });
});

describe("the faces of the documents", () => {
  it("are faces of the design system with a TTF file next to the woff2 (the renderer cannot read woff2)", () => {
    const known = new Map(fontFaces.map((f) => [`${f.family}|${f.weight}`, f]));
    for (const [role, faces] of Object.entries(FAMILY)) {
      for (const face of faces) {
        const f = known.get(`${face.family}|${face.weight}`);
        expect(f, `${role}: ${face.family} ${face.weight}`).toBeDefined();
        expect(fontFile(f as NonNullable<typeof f>, "ttf")).toMatch(/\.ttf$/);
      }
    }
  });

  it("never use a face of the anti-list", () => {
    const all = Object.values(FAMILY)
      .flat()
      .map((f) => f.family.toLowerCase());
    for (const banned of ["geist", "inter", "onest", "source serif", "manrope"]) {
      expect(
        all.some((f) => f === banned || f.startsWith(`${banned} `)),
        banned,
      ).toBe(false);
    }
  });
});
