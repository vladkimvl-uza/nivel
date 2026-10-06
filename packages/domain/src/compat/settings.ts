import { bp } from "../money/index.ts";
import type { CompatSettings } from "./types.ts";

/**
 * Default thresholds (ARCHITECTURE 4.4, blocks 15 and 28). The owner edits them in the admin; the code takes them as an
 * argument. The object and its arrays are frozen at run time, but typed as the frozen contract `CompatSettings`
 * (`number[]`, tuples: `readonly` there needs an ADR), hence the casts. A caller that wants to change a value starts from
 * `defaultCompatSettings()`, which returns a mutable copy: `{ ...DEFAULT_COMPAT_SETTINGS }` would share the frozen arrays.
 */
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

/** A copy of the defaults whose arrays can be changed (the form of the admin settings starts from it). */
export function defaultCompatSettings(): CompatSettings {
  const d = DEFAULT_COMPAT_SETTINGS;
  return {
    ...d,
    psuSeriesW: [...d.psuSeriesW],
    eyeDistanceMm: [...d.eyeDistanceMm],
    standDepthMm: [...d.standDepthMm],
  };
}
