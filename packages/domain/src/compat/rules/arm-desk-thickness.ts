import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** The desktop thickness must be within the range the arm clamp or grommet takes. */
export const armDeskThickness = setupRule({
  id: "ARM_DESK_THICKNESS",
  applies: (b) => hasAll(b, "arm", "desk"),
  run(b) {
    const desk = firstOf(b, "desk");
    if (!desk) return [];
    const p = new Probe("ARM_DESK_THICKNESS");
    const deskMm = p.need(desk, "desk", "topThicknessMm");
    const found: CompatIssue[] = [];
    for (const arm of itemsOf(b, "arm")) {
      const minMm = p.need(arm, "arm", "topThicknessMinMm");
      const maxMm = p.need(arm, "arm", "topThicknessMaxMm");
      if (deskMm === undefined || minMm === undefined || maxMm === undefined) continue;
      if (deskMm < minMm || deskMm > maxMm) {
        found.push(
          issue("ARM_DESK_THICKNESS", "block", [arm.product.id, desk.product.id], "compat.arm_desk_thickness", {
            deskMm,
            minMm,
            maxMm,
          }),
        );
      }
    }
    return p.result(found);
  },
});
