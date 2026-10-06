import type { ProductId } from "../../catalog/types.ts";
import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * PSU plugs against the connectors of all cards. 6-pin and 8-pin plugs both take a PCIe 8-pin outlet.
 * A 12V-2x6 card needs a native cable (block without one); an adapter from the card box makes it a warning.
 */
export const psuGpuConnectors = pcRule({
  id: "PSU_GPU_CONNECTORS",
  applies: (b) => hasAll(b, "psu", "gpu"),
  run(b) {
    const psu = firstOf(b, "psu");
    if (!psu) return [];
    const p = new Probe("PSU_GPU_CONNECTORS");
    let need8 = 0;
    let need12 = 0;
    const ids8: ProductId[] = [];
    const ids12: ProductId[] = [];
    let allHaveAdapter = true;
    for (const gpu of itemsOf(b, "gpu")) {
      const power = p.need(gpu, "gpu", "power");
      if (power === undefined) continue;
      const n12 = power.filter((c) => c.conn === "12V-2x6").reduce((n, c) => n + c.count, 0);
      const n8 = power.filter((c) => c.conn !== "12V-2x6").reduce((n, c) => n + c.count, 0);
      if (n8 > 0) ids8.push(gpu.product.id);
      need8 += n8 * gpu.qty;
      if (n12 > 0) {
        ids12.push(gpu.product.id);
        need12 += n12 * gpu.qty;
        const adapter = p.need(gpu, "gpu", "adapterInBox");
        if (adapter !== true) allHaveAdapter = false;
      }
    }
    const found: CompatIssue[] = [];
    if (need8 > 0) {
      const have = p.need(psu, "psu", "pcie8pin");
      if (have !== undefined && need8 > have) {
        found.push(
          issue(
            "PSU_GPU_CONNECTORS",
            "block",
            [psu.product.id, ...ids8],
            "compat.psu_8pin_missing",
            { need: need8, have },
            { category: "psu", filter: { pcie8pinMin: need8 } },
          ),
        );
      }
    }
    if (need12 > 0) {
      const have = p.need(psu, "psu", "native12v2x6");
      if (have !== undefined && need12 > have && !p.incomplete) {
        const ids = [psu.product.id, ...ids12];
        found.push(
          allHaveAdapter
            ? issue("PSU_GPU_CONNECTORS", "warn", ids, "compat.psu_12v2x6_adapter", { need: need12, have })
            : issue(
                "PSU_GPU_CONNECTORS",
                "block",
                ids,
                "compat.psu_12v2x6_missing",
                { need: need12, have },
                { category: "psu", filter: { native12v2x6Min: need12 } },
              ),
        );
      }
    }
    return p.result(found);
  },
});
