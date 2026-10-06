import { type Item, itemsOf } from "./resolve.ts";
import type { Probe } from "./rule-kit.ts";
import type { ResolvedBuild } from "./types.ts";

export interface ArmPair {
  monitor: Item;
  arm: Item;
}

/**
 * Monitors take arm places in line order: the first monitor units go to the first arm's screens, and so on; the rest
 * stand on their own stands. An arm whose screen count is unknown carries one monitor (recorded as missing data).
 */
export function assignMonitors(b: ResolvedBuild, p: Probe): { onArm: ArmPair[]; onStand: Item[] } {
  const places: Item[] = [];
  for (const arm of itemsOf(b, "arm")) {
    const screens = p.need(arm, "arm", "screens") ?? 1;
    for (let i = 0; i < screens * arm.qty; i++) places.push(arm);
  }
  const onArm: ArmPair[] = [];
  const onStand: Item[] = [];
  let next = 0;
  for (const monitor of itemsOf(b, "monitor")) {
    const stands: number[] = [];
    for (let i = 0; i < monitor.qty; i++) {
      const arm = places[next++];
      if (arm) onArm.push({ monitor, arm });
      else stands.push(i);
    }
    if (stands.length > 0) onStand.push({ product: monitor.product, qty: stands.length });
  }
  return { onArm, onStand };
}

/** One entry per (monitor, arm) pair, whatever the quantities. */
export function uniquePairs(pairs: readonly ArmPair[]): ArmPair[] {
  const seen = new Set<string>();
  return pairs.filter((x) => {
    const key = `${x.monitor.product.id}|${x.arm.product.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
