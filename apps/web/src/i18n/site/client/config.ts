// What the server hands to the scripts of the page: the addresses of the media, the texts that change while the visitor scrolls
// and the state the page was served in. A plain object (it travels as a prop of the island), built by `buildSiteConfig`.
import { posterPath } from "../hero-model.ts";
import { mediaUrl } from "../media-url.ts";

export type Density = "m" | "1280" | "1920";
export type Side = "d" | "m";

export interface SiteConfig {
  locale: "uz" | "ru";
  /** The page was served static: the visitor switched the animation off, or the browser asked to save traffic. */
  reduced: boolean;
  hero: {
    /** File of the montage for each size, inside the media folder (`nivel-night-brand-1280.mp4`) as an address. */
    video: Record<Density, string>;
    /** Addresses of the four posters for each size. */
    posters: Record<Density, string[]>;
    /** `{n} / 04 · {name}` with the arguments left in. */
    stepNow: string;
    stepNames: string[];
  };
  bg: {
    /** Texts of the ruler and of the scenes, see labels.ts. */
    labels: Record<string, string>;
    /** Still frames of the stages: light (k), table (c) and the three stages with a clip (x, y, t). */
    stills: Record<"k" | "c" | "x" | "y" | "t", Record<Side, string>>;
    clips: Record<"x" | "y" | "t", Record<Side, string>>;
    /** The film grain tile. */
    grain: string;
    /** Sum written under the receipts that have come, for 0..9 of them. */
    receiptSums: string[];
    /** What goes back to the customer in the sample order, as a sum with its unit. */
    refund: string;
  };
  motion: { on: string; off: string };
}

export interface ConfigInput {
  mediaBase: string;
  locale: "uz" | "ru";
  reduced: boolean;
  labels: Record<string, string>;
  stepNames: string[];
  stepNow: string;
  receiptSums: string[];
  refund: string;
  motion: { on: string; off: string };
}

const SIZES: readonly Density[] = ["m", "1280", "1920"];

export function buildSiteConfig(i: ConfigInput): SiteConfig {
  const at = (path: string) => mediaUrl(i.mediaBase, path);
  const sides = (name: string, ext: string): Record<Side, string> => ({
    d: at(`bg/${name}-d.${ext}`),
    m: at(`bg/${name}-m.${ext}`),
  });
  return {
    locale: i.locale,
    reduced: i.reduced,
    hero: {
      video: Object.fromEntries(SIZES.map((s) => [s, at(`nivel-night-brand-${s}.mp4`)])) as Record<Density, string>,
      posters: Object.fromEntries(
        SIZES.map((s) => [s, [0, 1, 2, 3].map((step) => at(posterPath(step, "brand", s)))]),
      ) as Record<Density, string[]>,
      stepNow: i.stepNow,
      stepNames: i.stepNames,
    },
    bg: {
      labels: i.labels,
      stills: {
        k: sides("k", "webp"),
        c: sides("c", "webp"),
        x: sides("x", "webp"),
        y: sides("y", "webp"),
        t: sides("t", "webp"),
      },
      clips: { x: sides("x", "mp4"), y: sides("y", "mp4"), t: sides("t", "mp4") },
      grain: at("bg/grain.webp"),
      receiptSums: i.receiptSums,
      refund: i.refund,
    },
    motion: i.motion,
  };
}
