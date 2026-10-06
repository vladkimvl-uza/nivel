import { bp } from "../money/index.ts";
import type { CompatSettings } from "./types.ts";

/** Default thresholds (ARCHITECTURE 4.4, blocks 15 and 28). The owner edits them in the admin; the code takes them as an argument. */
export const DEFAULT_COMPAT_SETTINGS: CompatSettings = Object.freeze({
  gpuLenWarnMarginMm: 10,
  coolerHeightWarnMarginMm: 5,
  psuMultiplier: 1.3,
  psuHeadroomWarnBp: bp(3000),
  psuSeriesW: Object.freeze([550, 650, 750, 850, 1000, 1200]) as unknown as number[],
  baseW: 50,
  perFanW: 5,
  pumpW: 15,
  rollbackZoneMm: 750,
  eyeDistanceMm: Object.freeze([500, 760]) as unknown as [number, number],
  standDepthMm: Object.freeze([150, 250]) as unknown as [number, number],
});
