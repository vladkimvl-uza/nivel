import { hasAll } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";
import { assignMonitors, uniquePairs } from "../setup-kit.ts";
import type { CompatIssue } from "../types.ts";

/** Monitor weight without the stand must be within the load range of one arm screen: too heavy and too light both block. */
export const armLoad = setupRule({
  id: "ARM_LOAD",
  applies: (b) => hasAll(b, "arm", "monitor"),
  run(b) {
    const p = new Probe("ARM_LOAD");
    const { onArm } = assignMonitors(b, p);
    const found: CompatIssue[] = [];
    for (const { monitor, arm } of uniquePairs(onArm)) {
      const weightKg = p.need(monitor, "monitor", "weightNoStandKg");
      const minKg = p.need(arm, "arm", "loadMinKg");
      const maxKg = p.need(arm, "arm", "loadMaxKg");
      if (weightKg === undefined) continue;
      const ids = [monitor.product.id, arm.product.id];
      if (maxKg !== undefined && weightKg > maxKg) {
        found.push(
          issue(
            "ARM_LOAD",
            "block",
            ids,
            "compat.arm_overload",
            { weightKg, maxKg },
            { category: "arm", filter: { loadMaxKgMin: weightKg } },
          ),
        );
      } else if (minKg !== undefined && weightKg < minKg) {
        found.push(issue("ARM_LOAD", "block", ids, "compat.arm_underload", { weightKg, minKg }));
      }
    }
    return p.result(found);
  },
});
