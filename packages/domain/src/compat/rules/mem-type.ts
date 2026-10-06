import { firstOf, hasAll, hasAny, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** Memory type must match the board and be supported by the processor. */
export const memType = pcRule({
  id: "MEM_TYPE",
  applies: (b) => hasAll(b, "ram") && hasAny(b, "mb", "cpu"),
  run(b) {
    const mb = firstOf(b, "mb");
    const cpu = firstOf(b, "cpu");
    const p = new Probe("MEM_TYPE");
    const found: CompatIssue[] = [];
    const boardType = mb ? p.need(mb, "mb", "ramType") : undefined;
    const cpuTypes = cpu ? p.need(cpu, "cpu", "memTypes") : undefined;
    for (const ram of itemsOf(b, "ram")) {
      const ramType = p.need(ram, "ram", "type");
      if (ramType === undefined) continue;
      if (mb && boardType !== undefined && ramType !== boardType) {
        found.push(
          issue("MEM_TYPE", "block", [ram.product.id, mb.product.id], "compat.mem_type_board", { ramType, boardType }),
        );
      }
      if (cpu && cpuTypes !== undefined && !cpuTypes.includes(ramType)) {
        found.push(
          issue("MEM_TYPE", "block", [ram.product.id, cpu.product.id], "compat.mem_type_cpu", {
            ramType,
            cpuTypes: cpuTypes.join(", "),
          }),
        );
      }
    }
    return p.result(found);
  },
});
