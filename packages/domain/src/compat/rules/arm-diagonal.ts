import { hasAll } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";
import { assignMonitors, uniquePairs } from "../setup-kit.ts";
import type { CompatIssue } from "../types.ts";

/** Screen diagonal against the diagonal range the arm is made for. */
export const armDiagonal = setupRule({
  id: "ARM_DIAGONAL",
  applies: (b) => hasAll(b, "arm", "monitor"),
  run(b) {
    const p = new Probe("ARM_DIAGONAL");
    const { onArm } = assignMonitors(b, p);
    const found: CompatIssue[] = [];
    for (const { monitor, arm } of uniquePairs(onArm)) {
      const diagIn = p.need(monitor, "monitor", "diagIn");
      const minIn = p.need(arm, "arm", "diagMinIn");
      const maxIn = p.need(arm, "arm", "diagMaxIn");
      if (diagIn === undefined || minIn === undefined || maxIn === undefined) continue;
      if (diagIn < minIn || diagIn > maxIn) {
        found.push(
          issue("ARM_DIAGONAL", "warn", [monitor.product.id, arm.product.id], "compat.arm_diagonal_out_of_range", {
            diagIn,
            minIn,
            maxIn,
          }),
        );
      }
    }
    return p.result(found);
  },
});
