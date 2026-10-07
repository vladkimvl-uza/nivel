// The look of the documents: "paper" of the design system (DESIGN_SYSTEM 3.7, ARCHITECTURE 5.7): the nivel-1 palette on
// paper #F1EFEA with asphalt ink and the orange of the mark. The colors come from the tokens of @nivel/ui (no raw HEX
// here, tools/check-antilist.mjs); the document does not depend on the theme of the site.
import { brand, compositeOver, parseColor, themeTokens } from "@nivel/ui";

/** `#RRGGBB` of an opaque color: the renderer reads neither rgba() nor alpha channels of a fill. */
const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("")}`;

const night = themeTokens.night;

export const palette = {
  paper: brand.paper,
  asphalt: brand.asphalt,
  /** The orange of the mark: fills, rules and big type. Small text uses `stamp` (contrast). */
  signal: brand.signal,
  ink: night.docInk,
  ink2: night.docInk2,
  /** The thin line of a table (docLine of the tokens) laid over the paper. */
  line: hex(compositeOver(parseColor(night.docLine), parseColor(brand.paper))),
  /** A band under totals and headers: the second sheet of the paper. */
  band: night.doc,
  /** Ink of stamps and of small accent text. */
  stamp: night.stamp,
  /** A refund to the customer in a table of sums. */
  minus: night.minus,
} as const;

export type PaletteName = keyof typeof palette;

/** Colors used for text: each is checked against the paper (4.5:1). */
export const textColors = ["ink", "ink2", "stamp", "minus"] as const satisfies readonly PaletteName[];

export const TEXT = "Fira Sans";
export const CONDENSED = "Fira Sans Extra Condensed";
/**
 * One mono face for both languages. The design system pairs Noto Sans Mono with Uzbek (in IBM Plex Mono the sign U+02BB looks
 * like an acute) and IBM Plex Mono with Russian, but the TTF of IBM Plex Mono in @nivel/ui breaks the renderer: fontkit throws
 * RangeError on the empty glyph of the space (gid 991, loca[991] = loca[992] = the end of glyf). Until that file is
 * exported again the documents use Noto Sans Mono, which has the same glyphs (report of WP-12, open issue).
 */
export const MONO = "Noto Sans Mono";

export interface FaceRef {
  readonly family: string;
  readonly weight: 400 | 500 | 600 | 700;
}

/** The faces the documents use, by role. Every one is a face of the design system with a TTF file. */
export const FAMILY = {
  text: [
    { family: TEXT, weight: 400 },
    { family: TEXT, weight: 500 },
  ],
  condensed: [
    { family: CONDENSED, weight: 600 },
    { family: CONDENSED, weight: 700 },
  ],
  mono: [
    { family: MONO, weight: 400 },
    { family: MONO, weight: 500 },
  ],
} as const satisfies Record<string, readonly FaceRef[]>;
