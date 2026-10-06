import { describe, expect, it } from "vitest";
import {
  AXES,
  bounce,
  CAMERA_STILL_AT,
  CLICKS,
  captionAlpha,
  createProfile,
  frameAt,
  frameFraction,
  glintAt,
  guideAlpha,
  INTRO_DURATION,
  introCameraAt,
  LAMP_BASE,
  LOOP_DURATION,
  lampForAspect,
  lampOn,
  loopCameraAt,
  PART_IDS,
  type PartId,
  partPose,
  recoilAt,
  visibleHalfExtents,
} from "./timeline.ts";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe("seat times and the end of the intro", () => {
  it("lists five seats in the order of the level mark: line, triangle, shelf, word, dot", () => {
    expect(CLICKS.map((c) => c.id)).toEqual(["line", "tri", "shelf", "word", "dot"]);
    expect(PART_IDS).toEqual(["line", "tri", "shelf", "word", "dot"]);
    expect(CLICKS.map((c) => c.t)).toEqual([0.52, 0.8, 1.14, 1.6, 2.12]);
  });

  it("takes the seat time of every part from its axis (one source for picture and sound)", () => {
    for (const c of CLICKS) expect(c.t).toBe(AXES[c.id].t1);
  });

  it("ends the intro at 3.3 s with at least one second of clean still lockup after the last seat", () => {
    expect(INTRO_DURATION).toBe(3.3);
    expect(INTRO_DURATION - (CLICKS.at(-1)?.t ?? 0)).toBeGreaterThanOrEqual(1);
    expect(LOOP_DURATION).toBe(12);
  });

  it("keeps seats apart: at least 0.25 s between two clicks (each is heard and seen)", () => {
    for (let i = 1; i < CLICKS.length; i++) {
      expect((CLICKS[i]?.t ?? 0) - (CLICKS[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("starts each part before it seats and seats it after it has started", () => {
    for (const id of PART_IDS) expect(AXES[id].t0).toBeLessThan(AXES[id].t1 - AXES[id].drop);
  });
});

describe("approach profile", () => {
  const profile = createProfile(0.35, 0.07, 0.15, false);

  it("runs from 0 to 1, never goes back, and is clamped outside 0..1", () => {
    expect(profile(0)).toBe(0);
    expect(near(profile(1), 1, 1e-6)).toBe(true);
    expect(profile(-3)).toBe(0);
    expect(profile(7)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = profile(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("brakes but never stops: the last step still moves (about 15 % of the peak speed)", () => {
    const step = 0.01;
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => profile((i + 1) * step) - profile(i * step)));
    const last = profile(1) - profile(1 - step);
    expect(last).toBeGreaterThan(peak * 0.1);
    expect(last).toBeLessThan(peak * 0.45);
  });

  it("starts slowly (70 ms of speed-up): the first step is slower than the middle one", () => {
    const first = profile(0.02) - profile(0);
    const mid = profile(0.32) - profile(0.3);
    expect(first).toBeLessThan(mid);
  });

  it("the i-dot profile (weight) accelerates longer and brakes later than the others", () => {
    const dot = createProfile(0.4, 0.12, 0.2, true);
    expect(dot(0.5)).toBeLessThan(profile(0.5));
    expect(near(dot(1), 1, 1e-6)).toBe(true);
  });
});

describe("bounce (out of the pocket only, restitution 0.42)", () => {
  it("is zero before the hit and after the bounces are over", () => {
    expect(bounce(0, 1.4, 0.075)).toBe(0);
    expect(bounce(-1, 1.4, 0.075)).toBe(0);
    expect(bounce(0.5, 1.4, 0.075)).toBe(0);
  });

  it("makes the first hop 1.4 units high in 75 ms", () => {
    expect(near(bounce(0.0375, 1.4, 0.075), 1.4)).toBe(true);
    expect(near(bounce(0.075, 1.4, 0.075), 0, 1e-9)).toBe(true);
  });

  it("makes the second hop 0.42 x 0.42 of the first and 0.42 of its duration", () => {
    const second = 1.4 * 0.42 * 0.42;
    expect(near(bounce(0.075 + 0.0315 / 2, 1.4, 0.075), second, 1e-9)).toBe(true);
  });

  it("never goes below the floor of the pocket (no negative height, no penetration)", () => {
    for (let i = 0; i <= 400; i++) expect(bounce(i * 0.001, 2, 0.075)).toBeGreaterThanOrEqual(0);
  });

  it("stops by itself even for a huge amplitude (finite loop)", () => {
    expect(bounce(10, 1000, 0.075)).toBe(0);
  });
});

describe("part poses over time", () => {
  const pose = (id: PartId, t: number) => partPose(id, t, { dotDistance: AXES.dot.dist });

  it("keeps every part away from its pocket at t = 0, with the shelf and triangle turned", () => {
    for (const id of PART_IDS) {
      const p = pose(id, 0);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(AXES[id].dist, 6);
      expect(p.z).toBe(AXES[id].zFrom);
    }
    expect(pose("tri", 0)).toMatchObject({ axis: "z", angleDeg: -7 });
    expect(pose("shelf", 0)).toMatchObject({ axis: "y", angleDeg: 14 });
    expect(pose("line", 0).axis).toBeNull();
  });

  it("brings each part along its own axis: the line from the left, the triangle from above, the shelf from the right", () => {
    const t = 0.3;
    expect(pose("line", t).x).toBeLessThan(0);
    expect(pose("line", t).y).toBe(0);
    expect(pose("tri", 0.6).y).toBeGreaterThan(0);
    expect(pose("tri", 0.6).x).toBe(0);
    expect(pose("shelf", 0.9).x).toBeGreaterThan(0);
    expect(pose("word", 1.3).x).toBeGreaterThan(0);
    expect(pose("dot", 1.9).y).toBeGreaterThan(0);
  });

  it("moves each part monotonically towards its pocket until it drops", () => {
    for (const id of PART_IDS) {
      const a = AXES[id];
      let prev = Number.POSITIVE_INFINITY;
      for (let t = a.t0; t <= a.t1 - a.drop; t += 0.005) {
        const p = pose(id, t);
        const d = Math.hypot(p.x, p.y);
        expect(d).toBeLessThanOrEqual(prev + 1e-9);
        prev = d;
      }
    }
  });

  it("hovers over the pocket (z = hover) until the drop, then falls to the floor with acceleration", () => {
    for (const id of PART_IDS) {
      const a = AXES[id];
      const beforeDrop = pose(id, a.t1 - a.drop - 1e-6);
      expect(beforeDrop.z).toBeCloseTo(a.hover, 3);
      expect(Math.hypot(beforeDrop.x, beforeDrop.y)).toBeCloseTo(a.dist * 0.015, 2);
      const half = pose(id, a.t1 - a.drop / 2);
      const k = 0.5;
      expect(half.z).toBeCloseTo(a.hover * (1 - k * k), 6);
      expect(pose(id, a.t1).z).toBeCloseTo(0, 9);
      expect(pose(id, a.t1).x).toBe(0);
    }
  });

  it("at the drop the pocket's lead-in chamfer takes the part: the last 1.5 % of the travel is covered together with the fall", () => {
    const a = AXES.word;
    const start = pose("word", a.t1 - a.drop);
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(a.dist * 0.015, 3);
    const mid = pose("word", a.t1 - a.drop / 2);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(a.dist * 0.0075, 3);
  });

  it("goes out of the pocket only in a bounce after the seat, never below the floor", () => {
    for (const id of PART_IDS) {
      for (let t = AXES[id].t1; t < INTRO_DURATION; t += 0.002) {
        const p = pose(id, t);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThanOrEqual(AXES[id].bounce + 1e-9);
        expect(p.x).toBe(0);
        expect(p.y).toBe(0);
        expect(p.angleDeg).toBe(0);
      }
    }
  });

  it("releases the turn smoothly (easeInOutSine) to 0 before the part is seated", () => {
    const a = AXES.tri;
    const early = pose("tri", a.t0 + 0.01).angleDeg;
    const late = pose("tri", a.t1 - a.drop - 1e-6).angleDeg;
    expect(Math.abs(early)).toBeGreaterThan(6.9);
    expect(Math.abs(late)).toBeLessThan(0.5);
    // the turn is gone while the part is still over the pocket, so it lands square
    expect(pose("tri", a.t1 - a.drop / 2).angleDeg).toBe(0);
  });

  it("rests in the final pose after the intro: z = 0 and no offset for every part", () => {
    for (const id of PART_IDS) {
      expect(pose(id, 2.5)).toEqual({ x: 0, y: 0, z: 0, axis: AXES[id].rot?.axis ?? null, angleDeg: 0 });
      expect(pose(id, INTRO_DURATION)).toMatchObject({ x: 0, y: 0, z: 0, angleDeg: 0 });
    }
  });

  it("derives the distance of the dot from the frame when it is given, otherwise uses the default", () => {
    expect(partPose("dot", 0, { dotDistance: 777 }).y).toBe(777);
    expect(partPose("dot", 0).y).toBe(AXES.dot.dist);
    expect(partPose("line", 0, { dotDistance: 777 }).x).toBe(-AXES.line.dist);
  });
});

describe("shock of a seat (recoil), glint, guides, caption, lamp", () => {
  it("shakes the whole assembly by about 1 px in the direction of arrival and returns in 25 ms", () => {
    const t1 = AXES.line.t1;
    expect(recoilAt(t1 - 0.01)).toEqual([0, 0]);
    const hit = recoilAt(t1);
    expect(hit[0]).toBeCloseTo(AXES.line.recoil[0], 6);
    expect(Math.abs(recoilAt(t1 + 0.1)[0])).toBeLessThan(0.01);
    expect(recoilAt(t1 + 0.13)).toEqual([0, 0]);
  });

  it("recoil follows the axis of the part: the triangle comes from above and is pushed down", () => {
    expect(recoilAt(AXES.tri.t1)[1]).toBeCloseTo(AXES.tri.recoil[1], 6);
    expect(AXES.tri.recoil[1]).toBeLessThan(0);
  });

  it("sums the shocks of parts that seat close together (no part is skipped)", () => {
    const sum = recoilAt(AXES.shelf.t1 + 0.0);
    expect(Number.isFinite(sum[0]) && Number.isFinite(sum[1])).toBe(true);
  });

  it("is quiet when nothing has seated or everything is over", () => {
    expect(recoilAt(0)).toEqual([0, 0]);
    expect(recoilAt(3)).toEqual([0, 0]);
  });

  it("runs the glint over the chamfers of the seated part for 0.42 s, azimuth 150 -> 30 degrees", () => {
    expect(glintAt(1.0, 1.14)).toEqual({ on: false, strength: 0, azimuthDeg: 150 });
    expect(glintAt(1.14, 1.14).on).toBe(false);
    expect(glintAt(1.14 + 0.43, 1.14).on).toBe(false);
    const g = glintAt(1.14 + 0.21, 1.14);
    expect(g.on).toBe(true);
    expect(g.azimuthDeg).toBeLessThan(150);
    expect(g.azimuthDeg).toBeGreaterThan(30);
    const early = glintAt(1.14 + 0.01, 1.14).azimuthDeg;
    const late = glintAt(1.14 + 0.41, 1.14).azimuthDeg;
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThanOrEqual(30);
  });

  it("makes the glint strength rise and fall: zero at both ends, the peak in between", () => {
    const at = (k: number) => glintAt(2 + k, 2).strength;
    expect(at(0.0001)).toBeLessThan(0.1);
    expect(at(0.41)).toBeLessThan(0.1);
    const peak = Math.max(...Array.from({ length: 41 }, (_, i) => at(0.01 + i * 0.01)));
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("fades the guide axes in over 0.2 s and out over 0.16 s", () => {
    expect(guideAlpha(-1, -1, 0.5)).toBe(0);
    expect(guideAlpha(0.1, -1, 0.5)).toBeCloseTo(1, 9);
    expect(guideAlpha(0.5, -1, 0.5)).toBeCloseTo(1, 9);
    expect(guideAlpha(0.5 + 0.16, -1, 0.5)).toBeCloseTo(0, 9);
    expect(guideAlpha(0.2, 0.2, 0.9)).toBe(0);
    const mid = guideAlpha(0.3, 0.2, 0.9);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("shows the level caption ±0.000 only while the shelf seats (1.16 - 1.62 s)", () => {
    expect(captionAlpha(1.0)).toBe(0);
    expect(captionAlpha(1.16)).toBe(0);
    expect(captionAlpha(1.24)).toBeCloseTo(1, 6);
    expect(captionAlpha(1.4)).toBeCloseTo(1, 6);
    expect(captionAlpha(1.62)).toBeCloseTo(0, 6);
    expect(captionAlpha(3)).toBe(0);
  });

  it("switches the lamp on at 0.06 s with a click: 62 % at once, full by 0.4 s", () => {
    expect(lampOn(0)).toBe(0);
    expect(lampOn(0.059)).toBe(0);
    expect(lampOn(0.06)).toBeCloseTo(0.62, 9);
    expect(lampOn(0.4)).toBeCloseTo(1, 6);
    expect(lampOn(5)).toBe(1);
    let prev = 0;
    for (let t = 0.06; t < 0.5; t += 0.01) {
      expect(lampOn(t)).toBeGreaterThanOrEqual(prev);
      prev = lampOn(t);
    }
  });
});

describe("camera", () => {
  it("starts at 16 degrees left and 10 up on the mark, 62 % of the final distance", () => {
    const c = introCameraAt(0);
    expect(c.yawDeg).toBeCloseTo(-16, 9);
    expect(c.pitchDeg).toBeCloseTo(10, 9);
    expect(c.targetBlend).toBe(0);
    expect(c.targetLift).toBeCloseTo(26, 9);
    expect(c.distanceFactor).toBeCloseTo(0.62, 9);
  });

  it("is still from 1.95 s: frontal, on the lockup, so the last seat (2.12 s) is seen in a fixed frame", () => {
    expect(CAMERA_STILL_AT).toBe(1.95);
    for (const t of [1.95, 2.12, 3.3]) {
      expect(introCameraAt(t)).toEqual({ yawDeg: 0, pitchDeg: 0, targetBlend: 1, targetLift: 0, distanceFactor: 1 });
    }
    expect(CAMERA_STILL_AT).toBeLessThan(AXES.dot.t1);
  });

  it("moves smoothly: yaw and pitch go monotonically to 0", () => {
    let yaw = -Infinity;
    let pitch = Infinity;
    for (let t = 0; t <= CAMERA_STILL_AT; t += 0.01) {
      const c = introCameraAt(t);
      expect(c.yawDeg).toBeGreaterThanOrEqual(yaw - 1e-9);
      expect(c.pitchDeg).toBeLessThanOrEqual(pitch + 1e-9);
      yaw = c.yawDeg;
      pitch = c.pitchDeg;
    }
  });

  it("the loop is in the final pose at tau = 0 (no seam), breathes by 2.2 and 1.1 degrees, and closes at 12 s", () => {
    expect(loopCameraAt(0, true)).toEqual({ yawDeg: 0, pitchDeg: 0 });
    expect(loopCameraAt(0, false)).toEqual({ yawDeg: 0, pitchDeg: 0 });
    const { yawDeg } = loopCameraAt(LOOP_DURATION / 4, false);
    expect(yawDeg).toBeCloseTo(2.2, 9);
    const max = Math.max(...Array.from({ length: 240 }, (_, i) => Math.abs(loopCameraAt(i * 0.05, false).pitchDeg)));
    expect(max).toBeLessThanOrEqual(1.1 + 1e-9);
    expect(loopCameraAt(LOOP_DURATION, false).yawDeg).toBeCloseTo(0, 9);
    expect(loopCameraAt(LOOP_DURATION + 3, false)).toEqual(loopCameraAt(3, false));
  });

  it("raises the amplitude of the loop over 3 s after the intro (ramp)", () => {
    const full = loopCameraAt(1.5, false).yawDeg;
    const ramped = loopCameraAt(1.5, true).yawDeg;
    expect(Math.abs(ramped)).toBeLessThan(Math.abs(full));
    expect(loopCameraAt(3 + 0.0, true).yawDeg).toBeCloseTo(loopCameraAt(3, false).yawDeg, 9);
  });
});

describe("frame of a mode at time t", () => {
  it("intro: plays up to 3.3 s and holds the last frame after", () => {
    expect(frameAt("intro", 1)).toEqual({ phase: "intro", t: 1 });
    expect(frameAt("intro", 99)).toEqual({ phase: "intro", t: INTRO_DURATION });
    expect(frameAt("intro", -2)).toEqual({ phase: "intro", t: 0 });
  });

  it("hero: intro, then the loop from its first moment, without a seam", () => {
    expect(frameAt("hero", 3.2999)).toEqual({ phase: "intro", t: 3.2999 });
    const after = frameAt("hero", 3.3001);
    expect(after.phase).toBe("loop");
    expect(after.t).toBeCloseTo(0.0001, 9);
    // the camera of the last intro frame equals the camera of the first loop frame
    expect(loopCameraAt(0, true)).toEqual({
      yawDeg: introCameraAt(INTRO_DURATION).yawDeg,
      pitchDeg: introCameraAt(INTRO_DURATION).pitchDeg,
    });
  });

  it("static: always the final frame of the intro", () => {
    expect(frameAt("static", 0)).toEqual({ phase: "intro", t: INTRO_DURATION });
    expect(frameAt("static", 100)).toEqual({ phase: "intro", t: INTRO_DURATION });
  });

  it("loop: the time is the time of the loop, without a ramp", () => {
    expect(frameAt("loop", 13)).toEqual({ phase: "loop", t: 13, ramp: false });
    expect(frameAt("hero", 4).ramp).toBe(true);
  });
});

describe("framing", () => {
  it("fits 62 % of the width on a wide frame and 80 % on a phone (below 700 px)", () => {
    expect(frameFraction(1080)).toBe(0.62);
    expect(frameFraction(699)).toBe(0.8);
    expect(frameFraction(700)).toBe(0.62);
  });

  it("shows more of the plate above and below the logo in a tall frame", () => {
    const sq = visibleHalfExtents(1, 1080);
    const tall = visibleHalfExtents(9 / 16, 1080);
    expect(sq.halfW).toBeCloseTo(sq.halfH, 6);
    expect(tall.halfW).toBeCloseTo(sq.halfW, 6);
    expect(tall.halfH).toBeGreaterThan(sq.halfH * 1.7);
  });

  it("is height-limited in a very wide frame (the lockup is never cut)", () => {
    const wide = visibleHalfExtents(4, 2000);
    expect(wide.halfH).toBeGreaterThanOrEqual(83 / 0.5 / 2 - 1e-9);
  });
});

describe("lamp: the pool of light follows the frame (no vignette in 9:16)", () => {
  it("never narrows below the base cone and never opens wider than 1.0 rad", () => {
    for (const aspect of [0.4, 0.5625, 1, 1.78, 3]) {
      for (const w of [390, 1080, 1920]) {
        const lamp = lampForAspect(aspect, w);
        expect(lamp.angle).toBeGreaterThanOrEqual(LAMP_BASE.angle);
        expect(lamp.angle).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it("opens the cone for a tall frame so the pool reaches the top and the bottom as far as in a square", () => {
    const sq = lampForAspect(1, 1080);
    const tall = lampForAspect(9 / 16, 1080);
    expect(tall.angle).toBeGreaterThan(sq.angle);
    // the plate radius lit at full by the cone, relative to the half-height of the frame, is the same in 1:1 and 9:16
    const rel = (aspect: number, a: { angle: number }) =>
      (LAMP_BASE.position[2] * Math.tan(a.angle)) / visibleHalfExtents(aspect, 1080).halfH;
    expect(rel(9 / 16, tall)).toBeCloseTo(rel(1, sq), 1);
  });

  it("keeps the 1:1 frame as the concept had it (the base cone)", () => {
    expect(lampForAspect(1, 1080).angle).toBeCloseTo(LAMP_BASE.angle, 6);
  });

  it("is deterministic and finite for odd frames", () => {
    for (const a of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const lamp = lampForAspect(a, 1080);
      expect(Number.isFinite(lamp.angle)).toBe(true);
      expect(lamp.angle).toBeGreaterThanOrEqual(LAMP_BASE.angle);
    }
  });
});
