import { specOf } from "../../catalog/specs.ts";
import { hasAll } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";
import { assignMonitors, uniquePairs } from "../setup-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * The monitor VESA pattern must be on the arm list. `vesa` absent on a monitor means "no VESA mount" (block), `null`
 * means unknown.
 */
export const armVesa = setupRule({
  id: "ARM_VESA",
  applies: (b) => hasAll(b, "arm", "monitor"),
  run(b) {
    const p = new Probe("ARM_VESA");
    const { onArm } = assignMonitors(b, p);
    const found: CompatIssue[] = [];
    for (const { monitor, arm } of uniquePairs(onArm)) {
      const raw = specOf(monitor.product, "monitor")?.vesa;
      if (raw === null) p.missing(monitor, "vesa");
      const monitorVesa = raw ?? undefined;
      const armVesa = p.need(arm, "arm", "vesa");
      if (raw === null || armVesa === undefined) continue;
      const ids = [monitor.product.id, arm.product.id];
      if (monitorVesa === undefined) {
        found.push(issue("ARM_VESA", "block", ids, "compat.arm_monitor_no_vesa", {}));
      } else if (!armVesa.includes(monitorVesa)) {
        found.push(
          issue(
            "ARM_VESA",
            "block",
            ids,
            "compat.arm_vesa_unsupported",
            { monitorVesa, armVesa: armVesa.join(", ") },
            { category: "arm", filter: { vesa: monitorVesa } },
          ),
        );
      }
    }
    return p.result(found);
  },
});
