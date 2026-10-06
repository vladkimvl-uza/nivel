import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * A clamp cannot sit over a leg zone of the desk (frame, leg, crossbar). `plan.placement` holds room coordinates keyed
 * by product id (left-back corner, x to the right); the clamp position is the arm x minus the desk x (0 when the desk is
 * not placed). Without any placement there is nothing to check; with a placement that lacks the arm, "placement" is
 * reported as missing. An arm that mounts through a hole (`grommet`) is checked as fine.
 */
export const armClampZone = setupRule({
  id: "ARM_CLAMP_ZONE",
  applies: (b, { plan }) => hasAll(b, "arm", "desk") && plan.placement !== undefined,
  run(b, { plan }) {
    const desk = firstOf(b, "desk");
    const placement = plan.placement;
    if (!desk || !placement) return [];
    const p = new Probe("ARM_CLAMP_ZONE");
    const zones = p.need(desk, "desk", "legZonesMm");
    const deskX = placement[desk.product.id]?.xMm ?? 0;
    const found: CompatIssue[] = [];
    for (const arm of itemsOf(b, "arm")) {
      const mount = p.need(arm, "arm", "mount");
      if (mount === undefined || mount === "grommet") continue;
      const at = placement[arm.product.id];
      if (!at) {
        p.missing(arm, "placement");
        continue;
      }
      if (zones === undefined) continue;
      const xMm = at.xMm - deskX;
      const zone = zones.find((z) => xMm >= z.fromMm && xMm <= z.toMm);
      if (zone) {
        found.push(
          issue("ARM_CLAMP_ZONE", "warn", [arm.product.id, desk.product.id], "compat.arm_clamp_over_leg", {
            xMm,
            fromMm: zone.fromMm,
            toMm: zone.toMm,
          }),
        );
      }
    }
    return p.result(found);
  },
});
