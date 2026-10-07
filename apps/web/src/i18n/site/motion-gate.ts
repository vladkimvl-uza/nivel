// When the first screen and the background may play video (ARCHITECTURE 5.6, BUILD_PLAN WP-16): a visitor who wants less
// motion, a browser that saves traffic, a slow channel or a weak device gets still posters, and not a single video request.
// The rules are those of the approved prototype (docs/design/hero-video/SOURCES.md 5); there are no query parameters that
// override them here.

export interface GateInput {
  /** The visitor switched the animation off on the site (the cookie `nv-motion=off`). */
  motionOff: boolean;
  /** `prefers-reduced-motion: reduce` of the system. */
  prefersReduced: boolean;
  /** `navigator.connection.saveData` or the header `Save-Data: on`. */
  saveData: boolean;
  /** `navigator.connection.effectiveType`: "slow-2g", "2g", "3g", "4g". */
  effectiveType?: string | undefined;
  /** Mbit/s. */
  downlink?: number | undefined;
  /** GB, `navigator.deviceMemory`. */
  deviceMemory?: number | undefined;
}

export type GateVerdict =
  | { ok: true; why: "ok" }
  | { ok: false; why: "reduced-motion" | "save-data" | "slow-net" | "weak-device" };

export function decideGate(i: GateInput): GateVerdict {
  if (i.motionOff || i.prefersReduced) return { ok: false, why: "reduced-motion" };
  if (i.saveData) return { ok: false, why: "save-data" };
  const type = i.effectiveType ?? "";
  if (/(^|-)2g$|^3g$/.test(type) || (type !== "" && type !== "4g" && i.downlink !== undefined && i.downlink < 2)) {
    return { ok: false, why: "slow-net" };
  }
  if ((i.deviceMemory ?? 8) < 2) return { ok: false, why: "weak-device" };
  return { ok: true, why: "ok" };
}

export type HeroMode = "video" | "posters" | "reduced";

/**
 * `reduced`: a static page (no pinned scroll, four stills in a grid, not a single video) for a visitor who wants less motion
 * and for a browser that saves traffic; `posters`: the same pinned scroll with stills (slow channel, weak device); `video`.
 */
export function heroMode(gate: GateVerdict): HeroMode {
  if (gate.ok) return "video";
  return gate.why === "reduced-motion" || gate.why === "save-data" ? "reduced" : "posters";
}

/** The videos of the background below the first screen: also not on a phone with less than 4 GB (unknown counts as 4). */
export function bgVideoAllowed(i: {
  reduced: boolean;
  gateOk: boolean;
  small: boolean;
  deviceMemory: number | undefined;
}): boolean {
  if (i.reduced || !i.gateOk) return false;
  return !(i.small && (i.deviceMemory ?? 4) < 4);
}

export type PosterSize = "m" | "1280" | "1920";

/** The vertical montage for a phone or a coarse pointer, 1920 only for a wide screen with a dense pixel grid. */
export function posterSize(i: { width: number; dpr: number; coarse: boolean }): PosterSize {
  if (i.width < 860 || i.coarse) return "m";
  return i.dpr >= 2 && i.width >= 1600 ? "1920" : "1280";
}
