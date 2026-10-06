import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** The cooler rated power must cover the processor maximum power. AIOs carry no rating and are not checked. */
export const coolerTdp = pcRule({
  id: "COOLER_TDP",
  applies: (b) => hasAll(b, "cooler_air", "cpu"),
  run(b) {
    const cpu = firstOf(b, "cpu");
    if (!cpu) return [];
    const p = new Probe("COOLER_TDP");
    const cpuW = p.need(cpu, "cpu", "maxPowerW");
    const found: CompatIssue[] = [];
    for (const cooler of itemsOf(b, "cooler_air")) {
      const coolerW = p.need(cooler, "cooler_air", "tdpRatedW");
      if (coolerW === undefined || cpuW === undefined || coolerW >= cpuW) continue;
      found.push(
        issue(
          "COOLER_TDP",
          "warn",
          [cooler.product.id, cpu.product.id],
          "compat.cooler_underpowered",
          { coolerW, cpuW },
          { category: "cooler_air", filter: { tdpRatedWMin: cpuW } },
        ),
      );
    }
    return p.result(found);
  },
});
