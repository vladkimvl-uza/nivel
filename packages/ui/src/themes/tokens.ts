// Colors of the two modes (DESIGN_SYSTEM 2.1 and 2.2). The only place besides themes.css with raw colors:
// tools/check-antilist.mjs allows them in `themes/` and nowhere else. Components use var(--role).
import type { Theme } from "../theming/ids.ts";

/** Brand core of nivel-1: the same in both modes. */
export const brand = {
  asphalt: "#1D1D1B",
  signal: "#D9501A",
  signalDark: "#F06A30",
  paper: "#F1EFEA",
} as const;

/**
 * Roles of one mode. Most are DESIGN_SYSTEM 2.2 verbatim; `stamp`, `minus` and `lampSpot` are colors that the
 * prototype hard-codes (stamp ink, refund line, warm spot under documents), turned into roles so that no component
 * carries a raw color.
 */
export interface ThemeTokens {
  bg: string;
  bg2: string;
  surface: string;
  stage: string;
  /** Text. `ink3` is for disabled and decorative marks only (below 4.5:1). */
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  /** Fills, the mark and large type; small text uses `accentInk`. */
  accent: string;
  accentInk: string;
  btnBg: string;
  btnInk: string;
  btnHover: string;
  hdrBg: string;
  chipBg: string;
  band: string;
  wood: string;
  woodInk: string;
  woodInk2: string;
  woodLine: string;
  foot: string;
  doc: string;
  doc2: string;
  docInk: string;
  docInk2: string;
  docLine: string;
  docShadow: string;
  cardShadow: string;
  /** Opacity of the two logo versions inside the header: switching the mode does not reload the SVG. */
  logoDay: string;
  logoNight: string;
  /** Ink of stamps on paper: darker at night, because the night paper is `#E9E3D7`. */
  stamp: string;
  /** Refund to the customer in a sum table. */
  minus: string;
  /** Warm spot behind documents: a lamp over the desk, not a glow (night only). */
  lampSpot: string;
  /** `<meta name="theme-color">`; not a CSS variable. */
  themeColor: string;
}

export const themeTokens: Record<Theme, ThemeTokens> = {
  day: {
    bg: "#F1EFEA",
    bg2: "#E9E5DD",
    surface: "#FBF9F4",
    stage: "#E4DDD2",
    ink: "#1D1D1B",
    ink2: "#5E574D",
    ink3: "#8A867E",
    line: "rgba(29,29,27,.14)",
    line2: "rgba(29,29,27,.28)",
    accent: "#D9501A",
    accentInk: "#A53F17",
    btnBg: "#1D1D1B",
    btnInk: "#F1EFEA",
    btnHover: "#000000",
    hdrBg: "#F1EFEA",
    chipBg: "rgba(241,239,234,.88)",
    band: "rgba(216,203,182,.45)",
    wood: "#6E4B2F",
    woodInk: "#F1ECE3",
    woodInk2: "#E2D6C4",
    woodLine: "rgba(241,236,227,.24)",
    foot: "#1D1D1B",
    doc: "#FBF9F4",
    doc2: "#F1EDE5",
    docInk: "#1D1D1B",
    docInk2: "#5E574D",
    docLine: "rgba(29,29,27,.16)",
    docShadow: "0 1px 0 rgba(29,29,27,.04),0 22px 44px -30px rgba(60,40,20,.45)",
    cardShadow: "0 1px 0 rgba(29,29,27,.04),0 18px 40px -28px rgba(60,40,20,.35)",
    logoDay: "1",
    logoNight: "0",
    stamp: "#C8481A",
    minus: "#9C3A12",
    lampSpot: "none",
    themeColor: "#F1EFEA",
  },
  night: {
    bg: "#121110",
    bg2: "#171513",
    surface: "#1A1816",
    stage: "#0E0C0B",
    ink: "#F1EFEA",
    ink2: "#A39C90",
    ink3: "#7A746B",
    line: "#2E2A26",
    line2: "#3B3631",
    accent: "#F06A30",
    accentInk: "#F06A30",
    btnBg: "#F1EFEA",
    btnInk: "#121110",
    btnHover: "#FFFFFF",
    hdrBg: "#121110",
    chipBg: "rgba(18,17,16,.82)",
    band: "rgba(226,168,103,.12)",
    wood: "#1E1712",
    woodInk: "#F1ECE3",
    woodInk2: "#C9BCA8",
    woodLine: "rgba(241,236,227,.16)",
    foot: "#0B0A09",
    doc: "#E9E3D7",
    doc2: "#DFD8CA",
    docInk: "#1D1D1B",
    docInk2: "#5A564F",
    docLine: "rgba(29,29,27,.2)",
    docShadow: "0 2px 0 rgba(0,0,0,.4),0 40px 80px -24px rgba(0,0,0,.75)",
    cardShadow: "0 1px 0 rgba(0,0,0,.3),0 24px 48px -30px rgba(0,0,0,.8)",
    logoDay: "0",
    logoNight: "1",
    stamp: "#A93F17",
    minus: "#9C3A12",
    lampSpot:
      "radial-gradient(48% 52% at 50% 42%, rgba(255,196,130,.11), rgba(255,196,130,.04) 55%, rgba(255,196,130,0) 75%)",
    themeColor: "#121110",
  },
};
