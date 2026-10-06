/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cmapCodePoints } from "../test-support/font-cmap.ts";
import { fontFaceCss, fontFaces, fontFile, fontLicenses, legacyFontFiles, requiredGlyphs } from "./catalog.ts";

const dir = fileURLToPath(new URL("../../fonts/", import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(`${dir}${name}`));
const cssFile = fileURLToPath(new URL("../styles/fonts.css", import.meta.url));

describe("font set (DESIGN_SYSTEM 2.3)", () => {
  it("has exactly the faces of the design system", () => {
    const list = fontFaces.map((f) => `${f.family} ${f.weight}`);
    expect(list).toEqual([
      "Brygada 1918 500",
      "Fira Sans 400",
      "Fira Sans 500",
      "Fira Sans Extra Condensed 600",
      "Fira Sans Extra Condensed 700",
      "IBM Plex Mono 400",
      "IBM Plex Mono 500",
      "Noto Sans Mono 400",
      "Noto Sans Mono 500",
    ]);
  });

  it("ships a woff2 for the site and a TTF for PDF for every face", () => {
    for (const f of fontFaces) {
      expect(existsSync(`${dir}${fontFile(f, "woff2")}`), fontFile(f, "woff2")).toBe(true);
      expect(existsSync(`${dir}${fontFile(f, "ttf")}`), fontFile(f, "ttf")).toBe(true);
    }
  });

  it("has no stray font files besides the faces and the transitional legacy files", () => {
    const known = new Set<string>(legacyFontFiles);
    for (const f of fontFaces) {
      known.add(fontFile(f, "woff2"));
      known.add(fontFile(f, "ttf"));
    }
    const present = readdirSync(dir).filter((n) => /\.(woff2?|ttf|otf)$/i.test(n));
    expect(present.filter((n) => !known.has(n))).toEqual([]);
    for (const n of legacyFontFiles) expect(present, n).toContain(n);
  });

  it("keeps the woff2 payload of the faces within the 260 KB budget (DESIGN_SYSTEM 5.5)", () => {
    const total = fontFaces.reduce((s, f) => s + statSync(`${dir}${fontFile(f, "woff2")}`).size, 0);
    expect(total).toBeLessThanOrEqual(260 * 1024);
  });

  it("carries each family licence (OFL) next to the files", () => {
    for (const l of fontLicenses) {
      const text = readFileSync(`${dir}licenses/${l.file}`, "utf8");
      expect(text, l.file).toContain("SIL OPEN FONT LICENSE Version 1.1");
      expect(text, l.file).toContain(l.copyright);
    }
    for (const f of fontFaces) expect(fontLicenses.map((l) => l.id)).toContain(f.license);
  });

  it("contains the Uzbek modifier letters U+02BB and U+02BC in every font file", () => {
    const files = readdirSync(dir).filter((n) => /\.(woff2|ttf)$/i.test(n));
    expect(files.length).toBeGreaterThanOrEqual(fontFaces.length * 2);
    for (const name of files) {
      const cps = cmapCodePoints(read(name));
      expect(cps.has(0x02bb), `${name} lacks U+02BB`).toBe(true);
      expect(cps.has(0x02bc), `${name} lacks U+02BC`).toBe(true);
    }
  });

  it("covers Latin, Cyrillic, nbsp, minus and the numero sign in every face (both formats)", () => {
    for (const f of fontFaces) {
      for (const ext of ["woff2", "ttf"] as const) {
        const cps = cmapCodePoints(read(fontFile(f, ext)));
        const missing = requiredGlyphs.filter((cp) => !cps.has(cp));
        expect(
          missing.map((cp) => cp.toString(16)),
          `${fontFile(f, ext)} missing code points`,
        ).toEqual([]);
      }
    }
  });
});

describe("@font-face stylesheet", () => {
  it("is generated from the catalog (run packages/ui/scripts/build-css.mjs after a change)", () => {
    expect(readFileSync(cssFile, "utf8")).toBe(fontFaceCss());
  });

  it("declares swap display, a woff2 source and the right weight for each face", () => {
    const css = fontFaceCss();
    for (const f of fontFaces) {
      expect(css).toContain(`font-family: "${f.family}";`);
      expect(css).toContain(`url("../../fonts/${fontFile(f, "woff2")}") format("woff2")`);
    }
    expect(css.match(/font-display: swap;/g)).toHaveLength(fontFaces.length);
    expect(css).not.toMatch(/https?:/);
  });
});
