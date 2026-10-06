import type { ProductId } from "../../catalog/types.ts";
import { assignM2 } from "../m2.ts";
import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import { classifySsds, m2Drives, sataCount } from "../ssd-kit.ts";

/**
 * An occupied M.2 slot may switch off SATA ports. Warns when the SATA drives still fit the port count but not the
 * ports left. Drives take the shortest slot that fits (see assignM2); disabled ports are counted as distinct numbers.
 */
export const m2SataSharing = pcRule({
  id: "M2_SATA_SHARING",
  applies: (b) => hasAll(b, "ssd", "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("M2_SATA_SHARING");
    const { nvme, sata } = classifySsds(b, p);
    const sataDrives = sataCount(sata);
    if (sataDrives === 0) return p.result([]);
    const ports = p.need(mb, "mb", "sataPorts");
    const slots = p.need(mb, "mb", "m2");
    const drives = m2Drives(nvme, p);
    if (ports === undefined || slots === undefined || p.incomplete) return p.result([]);
    if (sataDrives > ports) return []; // SATA_PORTS blocks this
    const { placed } = assignM2(drives, slots);
    const disabled = new Set<number>();
    const culprits = new Set<ProductId>();
    for (const { drive, slot } of placed) {
      if (slot.disablesSata.length === 0) continue;
      for (const n of slot.disablesSata) disabled.add(n);
      culprits.add(drive.tag.product.id);
    }
    const usablePorts = Math.max(0, ports - disabled.size);
    if (sataDrives <= usablePorts) return [];
    return [
      issue("M2_SATA_SHARING", "warn", [mb.product.id, ...culprits], "compat.m2_disables_sata", {
        sataDrives,
        usablePorts,
      }),
    ];
  },
});
