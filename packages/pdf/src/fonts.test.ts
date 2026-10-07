import { existsSync } from "node:fs";
import { fontFaces, fontFile, requiredGlyphs } from "@nivel/ui";
import { Document, Page, Text } from "@react-pdf/renderer";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { fontPath, registerFonts } from "./fonts.ts";
import { toPdfBuffer } from "./render.ts";
import { parsePdf } from "./testkit.ts";
import { FAMILY, MONO } from "./theme.ts";

const SAMPLE = "Oʻzbekiston Gʻafur maʼlumot toʻlov 0123456789 — «» № −1 234 Русский текст Ёё";

async function render(family: string, weight: number): Promise<ReturnType<typeof parsePdf>> {
  registerFonts();
  const doc = h(
    Document,
    null,
    h(Page, { size: "A4" }, h(Text, { style: { fontFamily: family, fontWeight: weight, fontSize: 12 } }, SAMPLE)),
  );
  return parsePdf(await toPdfBuffer(doc));
}

describe("fonts of the documents", () => {
  it("are TTF files of @nivel/ui and exist on disk", () => {
    for (const face of Object.values(FAMILY).flat()) {
      const known = fontFaces.find((f) => f.family === face.family && f.weight === face.weight);
      expect(known, `${face.family} ${face.weight}`).toBeDefined();
      const path = fontPath(known as NonNullable<typeof known>);
      expect(path.endsWith(fontFile(known as NonNullable<typeof known>, "ttf"))).toBe(true);
      expect(existsSync(path), path).toBe(true);
    }
  });

  it("registers once and does not fail when asked again", () => {
    registerFonts();
    expect(() => registerFonts()).not.toThrow();
  });

  it("uses Noto Sans Mono for the numbers: IBM Plex Mono is left out while its TTF breaks the renderer on the space", () => {
    expect(MONO).toBe("Noto Sans Mono");
    expect(
      Object.values(FAMILY)
        .flat()
        .some((f) => (f.family as string) === "IBM Plex Mono"),
    ).toBe(false);
  });

  for (const face of Object.values(FAMILY).flat()) {
    it(`draws the Uzbek letters and the Russian text with ${face.family} ${face.weight}, with no missing glyph`, async () => {
      const pdf = await render(face.family, face.weight);
      expect(pdf.text).not.toContain("\u0000");
      expect(pdf.text).not.toContain("�");
      for (const cp of [0x2bb, 0x2bc, 0x2116, 0x2212, 0x401, 0x451]) {
        expect(
          pdf.fonts.some((f) => f.codePoints.has(cp)),
          `U+${cp.toString(16)} in ${face.family}`,
        ).toBe(true);
      }
      expect(pdf.text).toContain("Oʻzbekiston Gʻafur maʼlumot toʻlov");
      expect(pdf.text).toContain("Русский текст Ёё");
      expect(pdf.fonts.every((f) => f.subset)).toBe(true);
    });
  }

  it("covers every code point the design system requires", async () => {
    registerFonts();
    const text = requiredGlyphs.map((c) => String.fromCodePoint(c)).join("");
    const doc = h(
      Document,
      null,
      h(Page, { size: "A4" }, h(Text, { style: { fontFamily: "Fira Sans", fontSize: 12 } }, text)),
    );
    const pdf = parsePdf(await toPdfBuffer(doc));
    expect(pdf.text).not.toContain("\u0000");
    const known = new Set(pdf.fonts.flatMap((f) => [...f.codePoints]));
    for (const cp of requiredGlyphs) expect(known.has(cp), `U+${cp.toString(16)}`).toBe(true);
  });
});
