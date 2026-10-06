// Boundary values and interplay of the setup rules that the scenario table does not spell out.
import { describe, expect, it } from "vitest";
import { checkSetup } from "../index.ts";
import { build, makeProduct, type Part, settings, setupParts } from "../testkit.ts";
import type { CompatIssue, RuleId, SetupPlan } from "../types.ts";

const run = (parts: Part[], over: Partial<SetupPlan> = {}, s = settings()) => {
  const b = build(...parts);
  const plan: SetupPlan = { room: { widthMm: 3000, depthMm: 2500, userHeightCm: 175 }, lines: b.lines, ...over };
  return checkSetup(plan, b.catalog, s);
};
const of = (parts: Part[], rule: RuleId, over: Partial<SetupPlan> = {}, s = settings()): CompatIssue[] =>
  run(parts, over, s).issues.filter((i) => i.ruleId === rule);
const keys = (xs: CompatIssue[]) => xs.map((i) => i.messageKey);

describe("DESK_WIDTH_MONITORS", () => {
  it("monitors exactly as wide as the desk fit", () => {
    expect(of(setupParts({ desk: { topWmm: 1228 }, qty: { monitor: 2 } }), "DESK_WIDTH_MONITORS")).toEqual([]);
    expect(of(setupParts({ desk: { topWmm: 1227 }, qty: { monitor: 2 } }), "DESK_WIDTH_MONITORS")).toHaveLength(1);
  });
  it("offers a desk that is wide enough as the fix", () => {
    const fix = of(setupParts({ qty: { monitor: 3 } }), "DESK_WIDTH_MONITORS")[0]?.fix;
    expect(fix).toEqual({ category: "desk", filter: { topWmmMin: 1842 } });
  });
});

describe("DESK_DEPTH_EYES", () => {
  const eyes = (topDmm: number) => keys(of(setupParts({ desk: { topDmm } }), "DESK_DEPTH_EYES"));
  it("500 mm and 760 mm to the eyes are both fine; one millimetre outside warns", () => {
    expect(eyes(700)).toEqual([]);
    expect(eyes(960)).toEqual([]);
    expect(eyes(699)).toEqual(["compat.eye_distance_short"]);
    expect(eyes(961)).toEqual(["compat.eye_distance_long"]);
  });
  it("a monitor on an arm is not judged by the depth of the desk", () => {
    expect(of(setupParts({ withArm: true, desk: { topDmm: 400 } }), "DESK_DEPTH_EYES")).toEqual([]);
  });
  it("unknown stand: reports only what holds for the whole 150-250 mm range, plus the missing data", () => {
    const unknown = { monitor: { standFootprintMm: null } };
    const fine = run(setupParts({ ...unknown, desk: { topDmm: 700 } }));
    expect(fine.issues.map((i) => i.messageKey)).toEqual(["compat.missing_data"]);
    const tooShallow = run(setupParts({ ...unknown, desk: { topDmm: 600 } }));
    expect(tooShallow.issues.map((i) => i.messageKey)).toEqual(["compat.eye_distance_short", "compat.missing_data"]);
    expect(tooShallow.issues[0]?.params).toEqual({ eyeMm: 450, minMm: 500 });
    const tooDeep = run(setupParts({ ...unknown, desk: { topDmm: 1100 } }));
    expect(tooDeep.issues[0]?.messageKey).toBe("compat.eye_distance_long");
    expect(tooDeep.issues[0]?.params).toEqual({ eyeMm: 850, maxMm: 760 });
    expect(tooDeep.verdict).toBe("incomplete");
  });
  it("takes the distance range from the settings", () => {
    const parts = setupParts();
    expect(of(parts, "DESK_DEPTH_EYES")).toEqual([]);
    expect(keys(of(parts, "DESK_DEPTH_EYES", {}, settings({ eyeDistanceMm: [600, 760] })))).toEqual([
      "compat.eye_distance_short",
    ]);
  });
});

describe("arm rules", () => {
  it("limits are inclusive: load, diagonal and desk thickness exactly at the edge are fine", () => {
    const edge = setupParts({
      withArm: true,
      monitor: { weightNoStandKg: 9, diagIn: 32 },
      desk: { topThicknessMm: 85 },
    });
    expect(run(edge).issues).toEqual([]);
    const low = setupParts({
      withArm: true,
      monitor: { weightNoStandKg: 2, diagIn: 13 },
      desk: { topThicknessMm: 10 },
    });
    expect(run(low).issues).toEqual([]);
  });

  it("the same monitor in quantity two on one arm place pair is reported once", () => {
    const parts = setupParts({
      withArm: true,
      arm: { screens: 2 },
      qty: { monitor: 2 },
      monitor: { weightNoStandKg: 12 },
    });
    expect(of(parts, "ARM_LOAD")).toHaveLength(1);
  });

  it("two arms with two different monitors: each monitor is checked against its own arm", () => {
    const big = makeProduct("monitor", "big", { vesa: "200x200", weightNoStandKg: 4 });
    const small = makeProduct("monitor", "small");
    const a1 = makeProduct("arm", "arm1", { vesa: ["200x200"] });
    const a2 = makeProduct("arm", "arm2", { vesa: ["75x75"] });
    const base = setupParts({ drop: ["monitor"] });
    // big -> arm1 (200x200 ok), small -> arm2 (100x100 not in the list)
    const r = run([...base, big, small, a1, a2]);
    const found = r.issues.filter((i) => i.ruleId === "ARM_VESA");
    expect(found.map((i) => [i.messageKey, [...i.productIds].sort()])).toEqual([
      ["compat.arm_vesa_unsupported", ["arm2", "small"]],
    ]);
  });

  it("a monitor with the VESA pattern on the arm list passes whatever else the arm lists", () => {
    const parts = setupParts({ withArm: true, arm: { vesa: ["400x400", "100x100"] } });
    expect(of(parts, "ARM_VESA")).toEqual([]);
  });

  it("ARM_LOAD offers an arm with a higher load limit as the fix", () => {
    const parts = setupParts({ withArm: true, monitor: { weightNoStandKg: 12 } });
    expect(of(parts, "ARM_LOAD")[0]?.fix).toEqual({ category: "arm", filter: { loadMaxKgMin: 12 } });
  });

  describe("ARM_CLAMP_ZONE", () => {
    const at = (xMm: number, extra: Record<string, { xMm: number; yMm: number }> = {}) =>
      of(setupParts({ withArm: true }), "ARM_CLAMP_ZONE", { placement: { arm: { xMm, yMm: 0 }, ...extra } });
    it("the edges of a leg zone are inside it", () => {
      expect(at(0)).toHaveLength(1);
      expect(at(100)).toHaveLength(1);
      expect(at(101)).toEqual([]);
      expect(at(1300)).toHaveLength(1);
      expect(at(1299)).toEqual([]);
    });
    it("a grommet arm has no clamp: fine over a leg zone", () => {
      const parts = setupParts({ withArm: true, arm: { mount: "grommet" } });
      expect(of(parts, "ARM_CLAMP_ZONE", { placement: { arm: { xMm: 50, yMm: 0 } } })).toEqual([]);
      expect(run(parts, { placement: {} }).checkedRules).toContain("ARM_CLAMP_ZONE");
    });
    it("an arm for both mounts is a clamp arm", () => {
      const parts = setupParts({ withArm: true, arm: { mount: "both" } });
      expect(of(parts, "ARM_CLAMP_ZONE", { placement: { arm: { xMm: 50, yMm: 0 } } })).toHaveLength(1);
    });
    it("a missing placement object is 'not placed yet': the rule does not run", () => {
      expect(run(setupParts({ withArm: true })).checkedRules).not.toContain("ARM_CLAMP_ZONE");
    });
  });
});

describe("CHAIR_ROLLBACK", () => {
  const room = (depthMm: number) => ({ room: { widthMm: 3000, depthMm, userHeightCm: 175 } });
  it("exactly the needed depth is fine, one millimetre less warns", () => {
    expect(of(setupParts(), "CHAIR_ROLLBACK", room(1450))).toEqual([]);
    expect(of(setupParts(), "CHAIR_ROLLBACK", room(1449))).toHaveLength(1);
  });
  it("a desk deeper than the room leaves no free depth (never negative)", () => {
    expect(of(setupParts(), "CHAIR_ROLLBACK", room(500))[0]?.params).toEqual({ freeMm: 0, needMm: 750 });
  });
  it("takes the default zone from the settings when the chair has none, and says so", () => {
    const parts = setupParts({ chair: { rollbackZoneMm: null } });
    const r = run(parts, room(1300), settings({ rollbackZoneMm: 600 }));
    expect(r.issues.map((i) => i.messageKey)).toEqual(["compat.missing_data"]); // 600 free, 600 needed
    const tight = run(parts, room(1200), settings({ rollbackZoneMm: 600 }));
    expect(tight.issues.map((i) => i.messageKey)).toEqual(["compat.chair_rollback_short", "compat.missing_data"]);
    expect(tight.verdict).toBe("incomplete");
  });
});

describe("CHAIR_USER_HEIGHT", () => {
  const user = (userHeightCm: number) =>
    of(setupParts(), "CHAIR_USER_HEIGHT", { room: { widthMm: 3000, depthMm: 2500, userHeightCm } });
  it("the edges of the range are inside it", () => {
    expect(user(160)).toEqual([]);
    expect(user(190)).toEqual([]);
    expect(user(159)).toHaveLength(1);
    expect(user(191)).toHaveLength(1);
  });
});
