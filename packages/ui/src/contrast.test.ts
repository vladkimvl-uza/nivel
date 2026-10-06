import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, parseColor, relativeLuminance } from "./themes/contrast.ts";
import { type ThemeTokens, themeTokens } from "./themes/tokens.ts";
import { themes } from "./theming/ids.ts";

type Role = Exclude<
  keyof ThemeTokens,
  "docShadow" | "cardShadow" | "lampSpot" | "lampOpacity" | "logoDay" | "logoNight" | "themeColor"
>;

/** Text on its background; a translucent background is first laid over `under` (what the visitor actually sees). */
interface Pair {
  fg: Role;
  bg: Role;
  under?: Role;
  note: string;
}

// Text pairs, WCAG 2.2 AA for body text: >= 4.5. `ink3` is deliberately absent: it is for disabled and decorative
// marks only and is never used for text by the primitives. The accent fill (`accent`) carries no small text: it is
// used for the mark, fills and large type (3.6:1), see DESIGN_SYSTEM 2.1.
// Two pairs are absent on purpose, found by this test: `accentInk` on `doc` is 2.4:1 at night (light orange on
// light paper), so inside a document a tag takes the stamp ink (`stamp` on `doc` is in the list); `stamp` on `doc2`
// is 4.1:1 by day and 4.3:1 at night, so stamps are never put on the `doc2` band (the prototype does not use it).
const TEXT_PAIRS: Pair[] = [
  { fg: "ink", bg: "bg", note: "body text on the page" },
  { fg: "ink", bg: "bg2", note: "body text on the alternate band" },
  { fg: "ink", bg: "surface", note: "body text on a card" },
  { fg: "ink", bg: "stage", note: "caption on the scene background" },
  { fg: "ink", bg: "hdrBg", note: "header" },
  { fg: "ink", bg: "chipBg", under: "bg", note: "chip over the page" },
  { fg: "ink", bg: "chipBg", under: "stage", note: "chip over the scene" },
  { fg: "ink2", bg: "bg", note: "secondary text" },
  { fg: "ink2", bg: "bg2", note: "secondary text on the band" },
  { fg: "ink2", bg: "surface", note: "secondary text on a card" },
  { fg: "ink2", bg: "stage", note: "secondary text on the scene" },
  { fg: "ink2", bg: "chipBg", under: "bg", note: "secondary text in a chip" },
  { fg: "ink2", bg: "chipBg", under: "stage", note: "visualization plaque over the scene" },
  { fg: "accentInk", bg: "bg", note: "tag and link in accent" },
  { fg: "accentInk", bg: "bg2", note: "tag on the band" },
  { fg: "accentInk", bg: "surface", note: "tag on a card" },
  { fg: "accentInk", bg: "band", under: "bg", note: "tag on the warm band" },
  { fg: "btnInk", bg: "btnBg", note: "primary button" },
  { fg: "btnInk", bg: "btnHover", note: "primary button on hover" },
  { fg: "bg", bg: "ink", note: "pressed chip and segment (inverted)" },
  { fg: "woodInk", bg: "wood", note: "passport section" },
  { fg: "woodInk2", bg: "wood", note: "secondary text of the passport section" },
  { fg: "docInk", bg: "doc", note: "document text" },
  { fg: "docInk", bg: "doc2", note: "document table band" },
  { fg: "docInk2", bg: "doc", note: "document secondary text" },
  { fg: "docInk2", bg: "doc2", note: "document secondary text on the band" },
  { fg: "doc", bg: "docInk", note: "sample plate (inverted)" },
  { fg: "stamp", bg: "doc", note: "stamp ink on paper" },
  { fg: "minus", bg: "doc", note: "refund line on paper" },
  { fg: "minus", bg: "doc2", note: "refund line on the paper band" },
];

describe("contrast of token pairs (WCAG 2.2 AA, >= 4.5:1) in both themes", () => {
  for (const theme of themes) {
    describe(theme, () => {
      for (const pair of TEXT_PAIRS) {
        const label = `${pair.fg} on ${pair.bg}${pair.under ? ` over ${pair.under}` : ""} (${pair.note})`;
        it(label, () => {
          const t = themeTokens[theme];
          const under = parseColor(t[pair.under ?? pair.bg]);
          const bg = compositeOver(parseColor(t[pair.bg]), under);
          const fg = compositeOver(parseColor(t[pair.fg]), bg);
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        });
      }

      it("accent for fills and the focus ring reaches 3:1 against the page and cards (WCAG 1.4.11)", () => {
        const t = themeTokens[theme];
        for (const bg of ["bg", "bg2", "surface"] as const) {
          expect(contrastRatio(parseColor(t.accent), parseColor(t[bg])), bg).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }

  it("matches the values stated in DESIGN_SYSTEM 2.1 (accent-ink 5.5:1 on paper, night accent 6.1:1)", () => {
    const d = themeTokens.day;
    const n = themeTokens.night;
    expect(contrastRatio(parseColor(d.accentInk), parseColor(d.bg))).toBeGreaterThanOrEqual(5.4);
    expect(contrastRatio(parseColor(d.ink), parseColor(d.bg))).toBeGreaterThanOrEqual(14.5);
    expect(contrastRatio(parseColor(n.accentInk), parseColor(n.bg))).toBeGreaterThanOrEqual(6);
    expect(contrastRatio(parseColor(n.ink), parseColor(n.bg))).toBeGreaterThanOrEqual(16);
    expect(contrastRatio(parseColor(d.ink2), parseColor(d.bg))).toBeGreaterThanOrEqual(6);
    expect(contrastRatio(parseColor(n.ink2), parseColor(n.bg))).toBeGreaterThanOrEqual(6);
  });
});

describe("color helpers", () => {
  it("parses #rgb, #rrggbb, #rrggbbaa and rgba()", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#1D1D1B")).toEqual({ r: 29, g: 29, b: 27, a: 1 });
    expect(parseColor("#00000080").a).toBeCloseTo(0.502, 2);
    expect(parseColor("rgba(29,29,27,.14)")).toEqual({ r: 29, g: 29, b: 27, a: 0.14 });
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it("rejects what is not a plain color", () => {
    expect(() => parseColor("none")).toThrow(/color/);
    expect(() => parseColor("#12")).toThrow(/color/);
    expect(() => parseColor("var(--bg)")).toThrow(/color/);
  });

  it("computes WCAG luminance and ratio (black on white is 21:1, same color is 1:1)", () => {
    const black = parseColor("#000");
    const white = parseColor("#fff");
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(black)).toBe(0);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
  });

  it("composites translucent colors over an opaque background", () => {
    const over = compositeOver(parseColor("rgba(0,0,0,.5)"), parseColor("#fff"));
    expect(over.r).toBeCloseTo(127.5, 5);
    expect(over.a).toBe(1);
    expect(compositeOver(parseColor("#102030"), parseColor("#fff"))).toEqual({ r: 16, g: 32, b: 48, a: 1 });
  });
});
