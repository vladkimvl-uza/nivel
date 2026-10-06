import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";

/**
 * Free depth behind the desk against the chair rollback zone. Free depth = room depth - (desk y + desk depth); the desk
 * stands against the back wall (y = 0) unless the plan places it. The zone is the chair's own `rollbackZoneMm`; when it
 * is unknown, `settings.rollbackZoneMm` (the 600-900 mm estimate, default 750) is used and the gap is reported.
 */
export const chairRollback = setupRule({
  id: "CHAIR_ROLLBACK",
  applies: (b) => hasAll(b, "chair", "desk"),
  run(b, { settings, plan }) {
    const chair = firstOf(b, "chair");
    const desk = firstOf(b, "desk");
    if (!chair || !desk) return [];
    const p = new Probe("CHAIR_ROLLBACK");
    const deskMm = p.need(desk, "desk", "topDmm");
    const own = p.need(chair, "chair", "rollbackZoneMm");
    if (deskMm === undefined) return p.result([]);
    const needMm = own ?? settings.rollbackZoneMm;
    const deskY = plan.placement?.[desk.product.id]?.yMm ?? 0;
    const freeMm = Math.max(0, plan.room.depthMm - (deskY + deskMm));
    if (freeMm >= needMm) return p.result([]);
    return p.result([
      issue("CHAIR_ROLLBACK", "warn", [chair.product.id, desk.product.id], "compat.chair_rollback_short", {
        freeMm,
        needMm,
      }),
    ]);
  },
});
