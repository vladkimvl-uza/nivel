import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** Tall memory under a tower cooler: the module must fit the cooler clearance. */
export const memCoolerClearance = pcRule({
  id: "MEM_COOLER_CLEARANCE",
  applies: (b) => hasAll(b, "ram", "cooler_air"),
  run(b) {
    const cooler = firstOf(b, "cooler_air");
    if (!cooler) return [];
    const p = new Probe("MEM_COOLER_CLEARANCE");
    const clearanceMm = p.need(cooler, "cooler_air", "ramClearanceMm");
    const found: CompatIssue[] = [];
    for (const ram of itemsOf(b, "ram")) {
      const ramMm = p.need(ram, "ram", "heightMm");
      if (ramMm === undefined || clearanceMm === undefined) continue;
      if (ramMm > clearanceMm) {
        found.push(
          issue("MEM_COOLER_CLEARANCE", "warn", [ram.product.id, cooler.product.id], "compat.mem_cooler_clearance", {
            ramMm,
            clearanceMm,
          }),
        );
      }
    }
    return p.result(found);
  },
});
