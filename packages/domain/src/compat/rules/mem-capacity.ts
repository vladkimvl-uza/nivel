import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/**
 * Total memory against the board maximum. The catalog has no per-processor capacity limit, so only the board is checked.
 */
export const memCapacity = pcRule({
  id: "MEM_CAPACITY",
  applies: (b) => hasAll(b, "ram", "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("MEM_CAPACITY");
    let totalGb = 0;
    for (const ram of itemsOf(b, "ram")) totalGb += (p.need(ram, "ram", "kitGb") ?? 0) * ram.qty;
    const maxGb = p.need(mb, "mb", "ramMaxGb");
    if (p.incomplete || maxGb === undefined) return p.result([]);
    if (totalGb <= maxGb) return [];
    const ids = [...itemsOf(b, "ram").map((r) => r.product.id), mb.product.id];
    return [issue("MEM_CAPACITY", "block", ids, "compat.mem_capacity_exceeded", { totalGb, maxGb })];
  },
});
