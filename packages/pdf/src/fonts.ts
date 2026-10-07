// Fonts of the documents: the TTF files of @nivel/ui (react-pdf cannot read woff2) registered once per process. Only the
// glyphs a document uses are embedded (the renderer subsets every face), which keeps a document far under 300 KB.
import { createRequire } from "node:module";
import { fontFaces, fontFile } from "@nivel/ui";
import { Font } from "@react-pdf/renderer";
import { FAMILY, type FaceRef } from "./theme.ts";

const require = createRequire(import.meta.url);

/** Absolute path of the TTF of a face; @nivel/ui exports `./fonts/*`. */
export function fontPath(face: (typeof fontFaces)[number]): string {
  return require.resolve(`@nivel/ui/fonts/${fontFile(face, "ttf")}`);
}

let registered = false;

export function registerFonts(): void {
  if (registered) return;
  const roles: readonly FaceRef[] = Object.values(FAMILY).flat();
  const byFamily = new Map<string, { src: string; fontWeight: number }[]>();
  for (const ref of roles) {
    const face = fontFaces.find((f) => f.family === ref.family && f.weight === ref.weight);
    if (face === undefined) throw new Error(`the face ${ref.family} ${ref.weight} is not in the design system`);
    const list = byFamily.get(ref.family) ?? [];
    list.push({ src: fontPath(face), fontWeight: ref.weight });
    byFamily.set(ref.family, list);
  }
  for (const [family, fonts] of byFamily) Font.register({ family, fonts });
  // No soft hyphens: a word of an Uzbek text with oʻ or gʻ must not be cut at a place the renderer guessed.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/**
 * Gives the next render fresh font objects. The renderer keeps one parsed font per registered face for the whole process, and
 * after a document with Cyrillic and Latin letters together the next document came out damaged: letters dropped from words
 * ("last" became "ast"), the text map of the PDF wrong. `Font.reset()` does not help (it keeps the cached promise, the next
 * render finds no font), so the parsed data and the promise of every face of ours are dropped by hand: the files are read
 * again, a few milliseconds per document.
 */
export function refreshFonts(): void {
  const families = Font.getRegisteredFonts();
  for (const { family } of Object.values(FAMILY).flat()) {
    for (const source of families[family]?.sources ?? []) {
      source.data = null;
      source.loadResultPromise = null;
    }
  }
}
