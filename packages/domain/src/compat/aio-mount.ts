import type { RadiatorMount } from "../catalog/types.ts";

/** Mounts of the case that take a radiator of the given size. */
export function mountsFor(mounts: readonly RadiatorMount[], radMm: number): RadiatorMount[] {
  return mounts.filter((m) => (m.sizesMm as readonly number[]).includes(radMm));
}

/**
 * True when the radiator fits only on the front panel, so the shorter "with front radiator" GPU limit applies.
 * With any other suitable mount (top, rear, side, bottom) the radiator is assumed to sit there. A radiator that fits
 * nowhere is AIO_RADIATOR_MOUNT's problem and does not tighten the GPU limit.
 */
export function isFrontOnly(mounts: readonly RadiatorMount[], radMm: number): boolean {
  const fit = mountsFor(mounts, radMm);
  return fit.length > 0 && fit.every((m) => m.side === "front");
}
