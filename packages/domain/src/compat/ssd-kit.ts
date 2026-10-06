import { M2_LENGTH_MM, type M2Drive } from "./m2.ts";
import { type Item, itemsOf } from "./resolve.ts";
import type { Probe } from "./rule-kit.ts";
import type { ResolvedBuild } from "./types.ts";

/** Splits the drives of a build by interface; an unknown interface is recorded as missing data in the probe. */
export function classifySsds(b: ResolvedBuild, p: Probe): { nvme: Item[]; sata: Item[] } {
  const nvme: Item[] = [];
  const sata: Item[] = [];
  for (const ssd of itemsOf(b, "ssd")) {
    const iface = p.need(ssd, "ssd", "iface");
    if (iface === "nvme") nvme.push(ssd);
    else if (iface === "sata") sata.push(ssd);
  }
  return { nvme, sata };
}

/**
 * One entry per physical NVMe drive (quantity expanded) with its length. A drive whose form factor is unknown, or is
 * not M.2 although the interface is NVMe, is recorded as missing data and left out.
 */
export function m2Drives(nvme: readonly Item[], p: Probe): M2Drive<Item>[] {
  const out: M2Drive<Item>[] = [];
  for (const item of nvme) {
    const ff = p.need(item, "ssd", "formFactor");
    if (ff === undefined) continue;
    const lenMm = M2_LENGTH_MM[ff];
    if (lenMm === undefined) {
      p.missing(item, "formFactor");
      continue;
    }
    for (let i = 0; i < item.qty; i++) out.push({ tag: item, lenMm });
  }
  return out;
}

export const sataCount = (sata: readonly Item[]): number => sata.reduce((n, i) => n + i.qty, 0);
