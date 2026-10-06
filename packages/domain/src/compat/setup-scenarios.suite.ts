// Scenario table for the 9 setup rules (see scenarios.suite.ts for the PC rules). Not part of the public API.

import type { Part } from "./testkit.ts";
import { DEFAULT_ROOM, makeProduct, omitSpec, setupParts } from "./testkit.ts";
import type { RuleId, SetupPlan, Severity } from "./types.ts";

export interface SetupInput {
  parts: Part[];
  /** Overrides of the default room; `undefined` removes a default field. */
  room?: { [K in keyof SetupPlan["room"]]?: SetupPlan["room"][K] | undefined };
  /** Placement by product id (room coordinates); none by default. */
  placement?: Record<string, { xMm: number; yMm: number }>;
}
export interface SetupExpect extends SetupInput {
  name: string;
  key: string;
  severity: Severity;
  params?: Record<string, string | number>;
  products?: string[];
}
export interface SetupMissing extends SetupInput {
  name: string;
  product: string;
  field: string;
}
export interface SetupScenario {
  ok: SetupInput;
  issues: SetupExpect[];
  missing: SetupMissing[];
  notApplicable: SetupInput;
}

type SetupRuleId = Extract<
  RuleId,
  | "DESK_DEPTH_EYES"
  | "DESK_WIDTH_MONITORS"
  | "ARM_VESA"
  | "ARM_LOAD"
  | "ARM_DIAGONAL"
  | "ARM_DESK_THICKNESS"
  | "ARM_CLAMP_ZONE"
  | "CHAIR_ROLLBACK"
  | "CHAIR_USER_HEIGHT"
>;

const stand = setupParts; // desk, monitor on its stand, chair
const arm = (o: Parameters<typeof setupParts>[0] = {}) => setupParts({ ...o, withArm: true }); // monitor on the arm
const onDesk = { arm: { xMm: 700, yMm: 0 } }; // clamp in the middle of the desk, away from the legs

export const SETUP_SCENARIOS: Record<SetupRuleId, SetupScenario> = {
  DESK_WIDTH_MONITORS: {
    ok: { parts: stand() },
    issues: [
      {
        name: "three 614 mm monitors on a 1400 mm desk",
        parts: stand({ qty: { monitor: 3 } }),
        key: "compat.monitors_wider_than_desk",
        severity: "block",
        params: { monitorsMm: 1842, deskMm: 1400 },
        products: ["desk", "monitor"],
      },
    ],
    missing: [
      { name: "panel width", parts: stand({ monitor: { panelWmm: null } }), product: "monitor", field: "panelWmm" },
      { name: "desk width", parts: stand({ desk: { topWmm: null } }), product: "desk", field: "topWmm" },
    ],
    notApplicable: { parts: stand({ drop: ["monitor"] }) },
  },
  DESK_DEPTH_EYES: {
    ok: { parts: stand() },
    issues: [
      {
        name: "a 600 mm desk leaves 400 mm to the eyes",
        parts: stand({ desk: { topDmm: 600 } }),
        key: "compat.eye_distance_short",
        severity: "warn",
        params: { eyeMm: 400, minMm: 500 },
        products: ["desk", "monitor"],
      },
      {
        name: "a 1000 mm desk leaves 800 mm to the eyes",
        parts: stand({ desk: { topDmm: 1000 } }),
        key: "compat.eye_distance_long",
        severity: "warn",
        params: { eyeMm: 800, maxMm: 760 },
        products: ["desk", "monitor"],
      },
    ],
    missing: [
      {
        name: "stand footprint",
        parts: stand({ monitor: { standFootprintMm: null } }),
        product: "monitor",
        field: "standFootprintMm",
      },
      { name: "desk depth", parts: stand({ desk: { topDmm: null } }), product: "desk", field: "topDmm" },
    ],
    notApplicable: { parts: stand({ drop: ["desk"] }) },
  },
  ARM_VESA: {
    ok: { parts: arm() },
    issues: [
      {
        name: "200x200 monitor on an arm for 75x75 and 100x100",
        parts: arm({ monitor: { vesa: "200x200" } }),
        key: "compat.arm_vesa_unsupported",
        severity: "block",
        params: { monitorVesa: "200x200", armVesa: "75x75, 100x100" },
        products: ["monitor", "arm"],
      },
      {
        name: "monitor without a VESA mount",
        parts: [omitSpec(makeProduct("monitor", "monitor"), "vesa"), ...arm({ drop: ["monitor"] })],
        key: "compat.arm_monitor_no_vesa",
        severity: "block",
        params: {},
        products: ["monitor", "arm"],
      },
    ],
    missing: [
      { name: "monitor VESA", parts: arm({ monitor: { vesa: null } }), product: "monitor", field: "vesa" },
      { name: "arm VESA list", parts: arm({ arm: { vesa: null } }), product: "arm", field: "vesa" },
    ],
    notApplicable: { parts: stand() },
  },
  ARM_LOAD: {
    ok: { parts: arm() },
    issues: [
      {
        name: "12 kg monitor on an arm for 9 kg",
        parts: arm({ monitor: { weightNoStandKg: 12 } }),
        key: "compat.arm_overload",
        severity: "block",
        params: { weightKg: 12, maxKg: 9 },
        products: ["monitor", "arm"],
      },
      {
        name: "1 kg monitor on an arm that needs at least 2 kg",
        parts: arm({ monitor: { weightNoStandKg: 1 } }),
        key: "compat.arm_underload",
        severity: "block",
        params: { weightKg: 1, minKg: 2 },
        products: ["monitor", "arm"],
      },
    ],
    missing: [
      {
        name: "monitor weight",
        parts: arm({ monitor: { weightNoStandKg: null } }),
        product: "monitor",
        field: "weightNoStandKg",
      },
      { name: "arm maximum load", parts: arm({ arm: { loadMaxKg: null } }), product: "arm", field: "loadMaxKg" },
      { name: "arm minimum load", parts: arm({ arm: { loadMinKg: null } }), product: "arm", field: "loadMinKg" },
    ],
    notApplicable: { parts: stand() },
  },
  ARM_DIAGONAL: {
    ok: { parts: arm() },
    issues: [
      {
        name: "34-inch monitor on an arm for 13 to 32 inches",
        parts: arm({ monitor: { diagIn: 34 } }),
        key: "compat.arm_diagonal_out_of_range",
        severity: "warn",
        params: { diagIn: 34, minIn: 13, maxIn: 32 },
        products: ["monitor", "arm"],
      },
    ],
    missing: [
      { name: "monitor diagonal", parts: arm({ monitor: { diagIn: null } }), product: "monitor", field: "diagIn" },
      { name: "arm maximum diagonal", parts: arm({ arm: { diagMaxIn: null } }), product: "arm", field: "diagMaxIn" },
    ],
    notApplicable: { parts: stand() },
  },
  ARM_DESK_THICKNESS: {
    ok: { parts: arm() },
    issues: [
      {
        name: "100 mm desktop, the clamp takes up to 85 mm",
        parts: arm({ desk: { topThicknessMm: 100 } }),
        key: "compat.arm_desk_thickness",
        severity: "block",
        params: { deskMm: 100, minMm: 10, maxMm: 85 },
        products: ["arm", "desk"],
      },
      {
        name: "5 mm desktop, the clamp needs at least 10 mm",
        parts: arm({ desk: { topThicknessMm: 5 } }),
        key: "compat.arm_desk_thickness",
        severity: "block",
        params: { deskMm: 5, minMm: 10, maxMm: 85 },
        products: ["arm", "desk"],
      },
    ],
    missing: [
      {
        name: "desktop thickness",
        parts: arm({ desk: { topThicknessMm: null } }),
        product: "desk",
        field: "topThicknessMm",
      },
      {
        name: "arm maximum thickness",
        parts: arm({ arm: { topThicknessMaxMm: null } }),
        product: "arm",
        field: "topThicknessMaxMm",
      },
      {
        name: "arm minimum thickness",
        parts: arm({ arm: { topThicknessMinMm: null } }),
        product: "arm",
        field: "topThicknessMinMm",
      },
    ],
    notApplicable: { parts: arm({ drop: ["desk"] }) },
  },
  ARM_CLAMP_ZONE: {
    ok: { parts: arm(), placement: onDesk },
    issues: [
      {
        name: "clamp at 50 mm from the left edge, over the leg zone 0 to 100 mm",
        parts: arm(),
        placement: { arm: { xMm: 50, yMm: 0 } },
        key: "compat.arm_clamp_over_leg",
        severity: "warn",
        params: { xMm: 50, fromMm: 0, toMm: 100 },
        products: ["arm", "desk"],
      },
      {
        name: "positions are measured from the desk when the desk is placed in the room",
        parts: arm(),
        placement: { desk: { xMm: 1000, yMm: 0 }, arm: { xMm: 2350, yMm: 0 } },
        key: "compat.arm_clamp_over_leg",
        severity: "warn",
        params: { xMm: 1350, fromMm: 1300, toMm: 1400 },
        products: ["arm", "desk"],
      },
    ],
    missing: [
      {
        name: "arm placement",
        parts: arm(),
        placement: { desk: { xMm: 0, yMm: 0 } },
        product: "arm",
        field: "placement",
      },
      {
        name: "leg zones",
        parts: arm({ desk: { legZonesMm: null } }),
        placement: onDesk,
        product: "desk",
        field: "legZonesMm",
      },
      { name: "mount type", parts: arm({ arm: { mount: null } }), placement: onDesk, product: "arm", field: "mount" },
    ],
    notApplicable: { parts: arm() },
  },
  CHAIR_ROLLBACK: {
    ok: { parts: stand() },
    issues: [
      {
        name: "1300 mm room, 700 mm desk: 600 mm behind the desk, 750 mm needed",
        parts: stand(),
        room: { depthMm: 1300 },
        key: "compat.chair_rollback_short",
        severity: "warn",
        params: { freeMm: 600, needMm: 750 },
        products: ["chair", "desk"],
      },
      {
        name: "the chair itself asks for 900 mm",
        parts: stand({ chair: { rollbackZoneMm: 900 } }),
        room: { depthMm: 1500 },
        key: "compat.chair_rollback_short",
        severity: "warn",
        params: { freeMm: 800, needMm: 900 },
        products: ["chair", "desk"],
      },
      {
        name: "a desk placed away from the wall takes more of the room",
        parts: stand(),
        room: { depthMm: 2000 },
        placement: { desk: { xMm: 0, yMm: 700 } },
        key: "compat.chair_rollback_short",
        severity: "warn",
        params: { freeMm: 600, needMm: 750 },
        products: ["chair", "desk"],
      },
    ],
    missing: [
      {
        name: "chair rollback zone",
        parts: stand({ chair: { rollbackZoneMm: null } }),
        product: "chair",
        field: "rollbackZoneMm",
      },
      { name: "desk depth", parts: stand({ desk: { topDmm: null } }), product: "desk", field: "topDmm" },
    ],
    notApplicable: { parts: stand({ drop: ["chair"] }) },
  },
  CHAIR_USER_HEIGHT: {
    ok: { parts: stand() },
    issues: [
      {
        name: "150 cm user, the chair is for 160 to 190 cm",
        parts: stand(),
        room: { userHeightCm: 150 },
        key: "compat.chair_user_height",
        severity: "warn",
        params: { userCm: 150, minCm: 160, maxCm: 190 },
        products: ["chair"],
      },
      {
        name: "200 cm user",
        parts: stand(),
        room: { userHeightCm: 200 },
        key: "compat.chair_user_height",
        severity: "warn",
        params: { userCm: 200, minCm: 160, maxCm: 190 },
        products: ["chair"],
      },
    ],
    missing: [
      {
        name: "chair user range",
        parts: stand({ chair: { userHeightCm: null } }),
        product: "chair",
        field: "userHeightCm",
      },
    ],
    notApplicable: { parts: stand(), room: { userHeightCm: undefined } },
  },
};

export const roomOf = (over: SetupInput["room"] = {}): SetupPlan["room"] => {
  const merged: Record<string, unknown> = { ...DEFAULT_ROOM, ...over };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged as SetupPlan["room"];
};
