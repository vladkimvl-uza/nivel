import type { M2Slot, SsdSpecs } from "../catalog/types.ts";

/** Length of the drive in mm by form factor; the 2.5" form factor is not an M.2 drive. */
export const M2_LENGTH_MM: Partial<Record<SsdSpecs["formFactor"], number>> = {
  "M.2-2242": 42,
  "M.2-2260": 60,
  "M.2-2280": 80,
};

export interface M2Drive<T> {
  tag: T;
  lenMm: number;
}
export interface M2Assignment<T> {
  placed: { drive: M2Drive<T>; slot: M2Slot }[];
  /** No free slot is long enough although free slots remained. */
  tooLong: M2Drive<T>[];
  /** Every slot was already taken. */
  noSlot: M2Drive<T>[];
}

/**
 * Greedy placement: longest drives first, each into the shortest free slot that fits; among equal slots the one that
 * disables fewer SATA ports comes first. This is optimal for the nested "slot is at least as long as the drive" order.
 */
export function assignM2<T>(drives: readonly M2Drive<T>[], slots: readonly M2Slot[]): M2Assignment<T> {
  const free = [...slots].sort((a, b) => a.maxLenMm - b.maxLenMm || a.disablesSata.length - b.disablesSata.length);
  const out: M2Assignment<T> = { placed: [], tooLong: [], noSlot: [] };
  for (const drive of [...drives].sort((a, b) => b.lenMm - a.lenMm)) {
    const at = free.findIndex((s) => s.maxLenMm >= drive.lenMm);
    if (at >= 0) {
      const [slot] = free.splice(at, 1);
      if (slot) out.placed.push({ drive, slot });
    } else if (free.length > 0) out.tooLong.push(drive);
    else out.noSlot.push(drive);
  }
  return out;
}
