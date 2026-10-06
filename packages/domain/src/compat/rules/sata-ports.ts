import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import { classifySsds, sataCount } from "../ssd-kit.ts";

/** SATA drives must not outnumber the SATA ports of the board. */
export const sataPorts = pcRule({
  id: "SATA_PORTS",
  applies: (b) => hasAll(b, "ssd", "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("SATA_PORTS");
    const { sata } = classifySsds(b, p);
    const count = sataCount(sata);
    if (count === 0) return p.result([]);
    const ports = p.need(mb, "mb", "sataPorts");
    if (ports === undefined || count <= ports) return p.result([]);
    return p.result([
      issue("SATA_PORTS", "block", [...sata.map((i) => i.product.id), mb.product.id], "compat.sata_ports_exceeded", {
        sata: count,
        ports,
      }),
    ]);
  },
});
