import { firstOf, hasAll, hasAny, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Memory faster than the board or the processor supports runs slower: "will work at N MT/s".
 * A memory type the processor does not support at all is ignored here: MEM_TYPE already blocks that pair. A supported
 * type without an entry in `memMaxMts` is missing data (the limit is unknown, not absent).
 */
export const memSpeed = pcRule({
  id: "MEM_SPEED",
  applies: (b) => hasAll(b, "ram") && hasAny(b, "mb", "cpu"),
  run(b) {
    const mb = firstOf(b, "mb");
    const cpu = firstOf(b, "cpu");
    const p = new Probe("MEM_SPEED");
    const boardMax = mb ? p.need(mb, "mb", "ramMaxMts") : undefined;
    const cpuTable = cpu ? p.need(cpu, "cpu", "memMaxMts") : undefined;
    const cpuTypes = cpu ? p.need(cpu, "cpu", "memTypes") : undefined;
    const found: CompatIssue[] = [];
    for (const ram of itemsOf(b, "ram")) {
      const ramMts = p.need(ram, "ram", "mts");
      const ramType = cpu ? p.need(ram, "ram", "type") : undefined;
      if (ramMts === undefined) continue;
      const caps: number[] = [];
      if (boardMax !== undefined) caps.push(boardMax);
      const cpuCap = ramType === undefined ? undefined : cpuTable?.[ramType];
      if (cpuCap !== undefined) caps.push(cpuCap);
      else if (cpu && cpuTable && ramType !== undefined && cpuTypes?.includes(ramType)) p.missing(cpu, "memMaxMts");
      if (caps.length === 0) continue;
      const effectiveMts = Math.min(...caps);
      if (ramMts > effectiveMts) {
        found.push(issue("MEM_SPEED", "warn", [ram.product.id], "compat.mem_speed_reduced", { ramMts, effectiveMts }));
      }
    }
    return p.result(found);
  },
});
