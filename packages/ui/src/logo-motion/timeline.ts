// Timeline of the intro "Fit to tolerance" (decision R-17, 06.10.2026): every frame is a pure function of time.
// No three, no DOM: the scene (scene.ts), the sound of the clips and the tests read the same numbers.
// Source: docs/design/logo-motion/fit (index.html and notes.md); the night set only (ADR-006).
// Units are the units of the lockup viewBox (348.6 x 83); Y is up, Z points to the camera, the plate surface is z = 0.

export const INTRO_DURATION = 3.3;
export const LOOP_DURATION = 12;
/** The camera stands still from this moment: the last two seats are seen in a fixed frame. */
export const CAMERA_STILL_AT = 1.95;
export const CAMERA_FOV_DEG = 20;
export const LOCKUP_SIZE = { width: 348.6, height: 83.0 } as const;
/** Centre of the lockup viewBox and of the mark, in scene units (Y up). */
export const LOCK_CENTER = { x: 170.3, y: 36, z: 0 } as const;
export const MARK_CENTER = { x: 43.73, y: 25.0, z: 0 } as const;
/** Depth of the pockets; the part is as high as the pocket is deep, so a seated part is flush with the plate. */
export const POCKET_DEPTH = 6;
export const CHAMFER = 1.3;

export type PartId = "line" | "tri" | "shelf" | "word" | "dot";
export const PART_IDS: readonly PartId[] = ["line", "tri", "shelf", "word", "dot"];

export interface AxisSpec {
  /** Direction of arrival in the plane of the plate. */
  readonly dir: readonly [number, number];
  /** Distance from the pocket at the start. */
  readonly dist: number;
  /** Height above the plate while the part approaches. */
  readonly hover: number;
  readonly zFrom: number;
  /** Start of the move and the moment of the seat (the click). */
  readonly t0: number;
  readonly t1: number;
  /** Time of the final fall into the pocket, s. */
  readonly drop: number;
  /** Height of the first bounce out of the pocket. */
  readonly bounce: number;
  /** Shock of the whole assembly in the direction of arrival, units. */
  readonly recoil: readonly [number, number];
  readonly rot: null | { readonly axis: "y" | "z"; readonly deg: number };
  /** Heavy part: longer speed-up, brakes later. */
  readonly gravity?: boolean;
}

export const AXES: Record<PartId, AxisSpec> = {
  line: {
    dir: [-1, 0],
    dist: 92,
    hover: 9,
    zFrom: 9,
    t0: 0.1,
    t1: 0.52,
    drop: 0.05,
    bounce: 1.4,
    recoil: [0.5, 0],
    rot: null,
  },
  tri: {
    dir: [0, 1],
    dist: 62,
    hover: 9,
    zFrom: 9,
    t0: 0.3,
    t1: 0.8,
    drop: 0.05,
    bounce: 1.4,
    recoil: [0, -0.5],
    rot: { axis: "z", deg: -7 },
  },
  shelf: {
    dir: [1, 0],
    dist: 104,
    hover: 9,
    zFrom: 9,
    t0: 0.74,
    t1: 1.14,
    drop: 0.05,
    bounce: 1.4,
    recoil: [-0.5, 0],
    rot: { axis: "y", deg: 14 },
  },
  word: {
    dir: [1, 0],
    dist: 250,
    hover: 9,
    zFrom: 9,
    t0: 1.02,
    t1: 1.6,
    drop: 0.055,
    bounce: 1.2,
    recoil: [-0.45, 0],
    rot: null,
  },
  dot: {
    dir: [0, 1],
    dist: 300,
    hover: 14,
    zFrom: 14,
    t0: 1.66,
    t1: 2.12,
    drop: 0.06,
    bounce: 2.0,
    recoil: [0, -0.6],
    rot: null,
    gravity: true,
  },
};

/** Times of the five seats (the click of the part in its pocket): the sound of the clips is cut on them. */
export const CLICKS: readonly { readonly id: PartId; readonly t: number }[] = PART_IDS.map((id) => ({
  id,
  t: AXES[id].t1,
}));

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** `a` at k = 0 and `b` at k = 1 exactly (no rounding at the ends). */
const lerp = (a: number, b: number, k: number) => a * (1 - k) + b * k;
const smoother = (x: number) => {
  const k = clamp(x);
  return k * k * k * (k * (k * 6 - 15) + 10);
};
const easeOutCubic = (x: number) => 1 - (1 - clamp(x)) ** 3;
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * clamp(x)) - 1) / 2;

/**
 * Travel of the approach as a function of the fraction of time: a short speed-up (`ta` s), then braking to `ve` of
 * the peak speed, never to zero. A `gravity` part speeds up for longer and brakes late.
 */
export function createProfile(Tz: number, ta: number, ve: number, gravity: boolean): (x: number) => number {
  const N = 256;
  const lut = new Float32Array(N + 1);
  const xa = Math.min(0.9, ta / Tz);
  const vel = (x: number) =>
    gravity
      ? Math.min(1, x / xa) * (x < 0.7 ? 0.25 + (0.75 * x) / 0.7 : ve + (1 - ve) * ((1 - x) / 0.3) ** 2)
      : Math.min(1, x / xa) * (ve + (1 - ve) * (1 - x) ** 2);
  let acc = 0;
  for (let i = 1; i <= N; i++) {
    acc += vel((i - 0.5) / N);
    lut[i] = acc;
  }
  for (let i = 0; i <= N; i++) lut[i] = (lut[i] as number) / acc;
  return (x) => {
    const p = clamp(x) * N;
    const i = Math.floor(p);
    return i >= N ? 1 : lerp(lut[i] as number, lut[i + 1] as number, p - i);
  };
}

/** Bounce after the hit, outward only (out of the pocket): hops of 75 ms and restitution 0.42 per hop. */
export function bounce(tau: number, amplitude: number, firstHop: number): number {
  if (tau <= 0) return 0;
  let a = amplitude;
  let T = firstHop;
  let t = tau;
  while (a > 0.03) {
    if (t < T) {
      const x = t / T;
      return 4 * a * x * (1 - x);
    }
    t -= T;
    T *= 0.42;
    a *= 0.42 * 0.42;
  }
  return 0;
}

const PROFILES = Object.fromEntries(
  PART_IDS.map((id) => {
    const a = AXES[id];
    const Tz = a.t1 - a.t0 - a.drop;
    return [id, createProfile(Tz, a.gravity ? 0.12 : 0.07, a.gravity ? 0.2 : 0.15, a.gravity === true)];
  }),
) as Record<PartId, (x: number) => number>;

/** Pose of a part relative to its pocket: offset in the plate plane, height, turn. */
export interface PartPose {
  x: number;
  y: number;
  z: number;
  axis: "y" | "z" | null;
  /** Turn about the centre of the part, degrees; 0 after the part has aligned over the pocket. */
  angleDeg: number;
}

export interface PoseOptions {
  /** Distance of the i-dot at the start: it comes from above the top edge of the frame, whatever the aspect. */
  dotDistance?: number;
}

/**
 * Where a part is at time `t`: 98.5 % of the way is covered by the approach; the last 1.5 % and the fall into
 * the pocket go together (the lead-in chamfer takes the part) and end on the floor; then a bounce outward.
 */
export function partPose(id: PartId, t: number, options: PoseOptions = {}): PartPose {
  const a = AXES[id];
  const dist = id === "dot" && options.dotDistance !== undefined ? options.dotDistance : a.dist;
  const Tz = a.t1 - a.t0 - a.drop;
  const tau = t - a.t0;
  let off: number;
  let z: number;
  let r = 0;
  if (tau <= 0) {
    off = dist;
    z = a.zFrom;
    r = 1;
  } else if (tau < Tz) {
    const x = tau / Tz;
    const s = 0.985 * PROFILES[id](x);
    off = dist * (1 - s);
    z = lerp(a.zFrom, a.hover, PROFILES[id](x));
    r = 1 - easeInOutSine(x / 0.85);
  } else if (tau < Tz + a.drop) {
    const k = (tau - Tz) / a.drop;
    off = dist * 0.015 * (1 - k);
    z = a.hover * (1 - k * k);
  } else {
    off = 0;
    z = bounce(t - a.t1, a.bounce, 0.075);
  }
  return {
    x: a.dir[0] * off + 0,
    y: a.dir[1] * off + 0,
    z,
    axis: a.rot?.axis ?? null,
    angleDeg: a.rot && r > 0 ? a.rot.deg * r : 0,
  };
}

/** Shock of every seat on the whole assembly: about 1 px in the direction of arrival, back in 25 ms. */
export function recoilAt(t: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const id of PART_IDS) {
    const a = AXES[id];
    const rc = t - a.t1;
    if (rc >= 0 && rc < 0.12) {
      const e = Math.exp(-rc / 0.025);
      x += a.recoil[0] * e;
      y += a.recoil[1] * e;
    }
  }
  return [x, y];
}

export interface Glint {
  on: boolean;
  /** 0..1, multiply by the strength of the night set. */
  strength: number;
  /** Azimuth of the chamfer that reflects the narrow source into the lens; it runs 150 -> 30 degrees. */
  azimuthDeg: number;
}

/** Raking glint on the chamfers of the part that has just seated (0.42 s, runs along the edges). */
export function glintAt(t: number, tClick: number): Glint {
  const k = t - tClick;
  if (!(k > 0 && k < 0.42)) return { on: false, strength: 0, azimuthDeg: 150 };
  const p = clamp(k / 0.42);
  return {
    on: true,
    strength: Math.sin(Math.PI * Math.sqrt(p)) ** 2,
    azimuthDeg: lerp(150, 30, easeOutCubic(p)),
  };
}

/** Opacity (0..1) of a dashed layout axis scribed on the plate: appears in 0.2 s, goes out in 0.16 s. */
export function guideAlpha(t: number, tShow: number, tHide: number): number {
  return smoother((t - tShow) / 0.2) * (1 - smoother((t - tHide) / 0.16));
}

/** The caption "±0.000" over the right end of the shelf, while the shelf seats (1.16 - 1.62 s). */
export function captionAlpha(t: number): number {
  return smoother((t - 1.16) / 0.08) * (1 - smoother((t - 1.5) / 0.12));
}

/** Lamp level 0..1: the switch clicks at 0.06 s and the lamp comes on at 62 % at once (driver ramp to full by 0.4 s). */
export function lampOn(t: number): number {
  return t < 0.06 ? 0 : 0.62 + 0.38 * easeOutCubic((t - 0.06) / 0.34);
}

export interface IntroCamera {
  yawDeg: number;
  pitchDeg: number;
  /** 0: aim at the mark, 1: aim at the middle of the lockup. */
  targetBlend: number;
  /** Extra height of the aim point, units. */
  targetLift: number;
  /** Distance as a fraction of the distance that frames the whole lockup. */
  distanceFactor: number;
}

/** Orbit from 16 degrees to the front and from the mark framing to the lockup framing; still from 1.95 s. */
export function introCameraAt(t: number): IntroCamera {
  const e = smoother(t / CAMERA_STILL_AT);
  const e2 = smoother((t - 0.3) / (CAMERA_STILL_AT - 0.3));
  return {
    yawDeg: lerp(-16, 0, e),
    pitchDeg: lerp(10, 0, e),
    targetBlend: e2,
    targetLift: lerp(26, 0, e),
    distanceFactor: lerp(0.62, 1, e2),
  };
}

/** The loop of the hero: the camera breathes by 2.2 degrees (yaw) and 1.1 (pitch); tau = 0 is the final intro pose. */
export function loopCameraAt(tau: number, ramp: boolean): { yawDeg: number; pitchDeg: number } {
  const w = (2 * Math.PI * (tau % LOOP_DURATION)) / LOOP_DURATION;
  const A = ramp ? smoother(tau / 3) : 1;
  return { yawDeg: A * 2.2 * Math.sin(w), pitchDeg: A * 1.1 * Math.sin(2 * w) };
}

export type MotionMode = "intro" | "hero" | "loop" | "static";

export interface FramePlan {
  phase: "intro" | "loop";
  /** Time inside the phase. */
  t: number;
  /** Loop only: the amplitude of the breathing is still growing (hero after the intro). */
  ramp?: boolean;
}

/** Which phase and which time inside it a mode shows at the clock `t`. */
export function frameAt(mode: MotionMode, t: number): FramePlan {
  const time = Math.max(0, t);
  if (mode === "static") return { phase: "intro", t: INTRO_DURATION };
  if (mode === "loop") return { phase: "loop", t: time, ramp: false };
  if (mode === "intro" || time < INTRO_DURATION) return { phase: "intro", t: Math.min(time, INTRO_DURATION) };
  return { phase: "loop", t: time - INTRO_DURATION, ramp: true };
}

/** Share of the frame width that the lockup takes: 80 % on a phone (below 700 px), 62 % elsewhere. */
export function frameFraction(widthPx: number): number {
  return widthPx < 700 ? 0.8 : 0.62;
}

/** Half of the plate area (units) that the final frame shows: the lockup fills `frameFraction` of the width. */
export function visibleHalfExtents(aspect: number, widthPx: number): { halfW: number; halfH: number } {
  const halfH = Math.max(LOCKUP_SIZE.width / frameFraction(widthPx) / 2 / aspect, LOCKUP_SIZE.height / 0.5 / 2);
  return { halfW: halfH * aspect, halfH };
}

/** Pixel of a point of the plate surface (z = 0, scene units, Y up) in the final frame of a `width` x `height` canvas. */
export function finalFramePoint(width: number, height: number, x: number, y: number): { px: number; py: number } {
  const perUnit = height / 2 / visibleHalfExtents(width / height, width).halfH;
  return { px: width / 2 + (x - LOCK_CENTER.x) * perUnit, py: height / 2 - (y - LOCK_CENTER.y) * perUnit };
}

/** The desk lamp: high over the table, aimed between the mark and the word (the mark gets as much light as the word). */
export const LAMP_BASE = {
  /** Relative to the middle of the lockup. */
  position: [-20, 300, 980],
  target: [-22, -4, 0],
  /** Half-angle of the cone, rad, and the soft edge. */
  angle: 0.44,
  penumbra: 0.9,
  /** Largest half-angle: beyond it the lamp would light the walls of the room, not the desk. */
  maxAngle: 1.0,
} as const;

/**
 * The cone follows the frame. At 1:1 the pool reaches 1.64 half-heights of the frame; a tall frame (9:16) shows
 * a plate 1.8 times higher, and a fixed cone left the top and the bottom in the dark, a vignette. The cone opens
 * so that the pool keeps the same ratio to the half-height, whatever the aspect.
 */
export function lampForAspect(aspect: number, widthPx: number): { angle: number; penumbra: number } {
  const keep = { angle: LAMP_BASE.angle, penumbra: LAMP_BASE.penumbra };
  if (!Number.isFinite(aspect) || aspect <= 0) return keep;
  const ref = visibleHalfExtents(1, 1080).halfH;
  const reach = (LAMP_BASE.position[2] * Math.tan(LAMP_BASE.angle)) / ref;
  const needed = Math.atan((reach * visibleHalfExtents(aspect, widthPx).halfH) / LAMP_BASE.position[2]);
  return { angle: clamp(needed, LAMP_BASE.angle, LAMP_BASE.maxAngle), penumbra: LAMP_BASE.penumbra };
}
