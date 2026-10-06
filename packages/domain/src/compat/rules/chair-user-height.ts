import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";

/** The user height from the room form must be within the range the chair is made for. Skipped without a user height. */
export const chairUserHeight = setupRule({
  id: "CHAIR_USER_HEIGHT",
  applies: (b, { plan }) => hasAll(b, "chair") && plan.room.userHeightCm !== undefined,
  run(b, { plan }) {
    const chair = firstOf(b, "chair");
    const userCm = plan.room.userHeightCm;
    if (!chair || userCm === undefined) return [];
    const p = new Probe("CHAIR_USER_HEIGHT");
    const range = p.need(chair, "chair", "userHeightCm");
    if (range === undefined) return p.result([]);
    const [minCm, maxCm] = range;
    if (userCm >= minCm && userCm <= maxCm) return [];
    return [
      issue("CHAIR_USER_HEIGHT", "warn", [chair.product.id], "compat.chair_user_height", { userCm, minCm, maxCm }),
    ];
  },
});
