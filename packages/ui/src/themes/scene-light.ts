// Light of the 3D scene, the night set only (DESIGN_SYSTEM 5.3; owner decision of 06.10.2026: the site has one mode),
// for the scene package (WP-21). The first screen is now the owner's video; the export is kept for later use.
// All colors are warm (R > G > B): no blue, no RGB backlight.

export const sceneLight = {
  colors: {
    /** Sky and ground colors of the hemisphere light; its intensity is below. */
    skyTop: "#FFF3E2",
    skyGround: "#A88E72",
    work: "#FFC690",
    lamp: "#FFC88E",
    lampShade: "#FFB36E",
    bounce: "#FFB873",
    screen: "#FFE6CC",
    roomFill: "#FFB677",
    roomFill2: "#FFC284",
    pcLed: "#FFE7C4",
    pcLight: "#FFD9B0",
  },
  background: { base: "#0E0C0B", final: "#17130F" },
  hemisphere: { base: 0.045, lite: 0.085, finalAdd: 0.1 },
  environment: { base: 0.025, final: 0.075 },
  /** Step 01 lights the empty desk (with a flicker); 02-03 the case; it fades at progress .74-.84 for the lamp. */
  work: { step1: 4.2, step2to3: 6 },
  lamp: { base: 9, lite: 10 },
  lampShadeEmissive: 0.34,
  /** Reflected from the desk to the wall behind the monitor, a multiple of the lamp. */
  bounceOfLamp: 1.3,
  screen: 0.6,
  room: { step4: 0.9, final: 1.7, fill: 0.9 },
  /** Radius of the screen light, m: it must not reach the wall under the desk. */
  screenRadius: 0.72,
  /** Barely visible warm white backlight of the PC. */
  pcLight: { intensity: { min: 0.05, max: 0.08 } },
  exposure: 1.08,
  fog: { near: 3.2, far: 9 },
  shadowMap: { full: 2048, lite: 1024 },
  flicker: { startMs: 0, endMs: 260, riseMs: 500 },
} as const;
