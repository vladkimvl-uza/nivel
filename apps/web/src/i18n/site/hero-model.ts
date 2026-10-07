// The first screen: the clips of the owner scrubbed by the scroll (docs/design/hero-video/index.html, montage v2). The numbers
// are those of the approved prototype; this module only turns the progress of the pinned track (0..1) into what the page
// shows: the caption, the step, the time of the clip, the fade at the end. No DOM here.

export const HERO = {
  fps: 25,
  /** Progress of the scroll at which each of the four steps starts, and the end. */
  stepsP: [0, 0.3, 0.55, 0.75, 1],
  /** The same borders as a time of the clip, seconds (middles of the dissolves). */
  stepsT: [0, 3.68, 7.76, 10.44, 14.0],
  /** After this progress the last frame is held and slowly comes closer. */
  hold: 0.92,
  /** Dissolves of the clip, seconds: a still scroll inside one shows the nearest clean frame. */
  dissolves: [
    [3.52, 3.84],
    [7.6, 7.92],
    [10.28, 10.6],
  ],
  /** Where the five captions start: the opening and "Selection" both belong to step one. */
  capB: [0, 0.11, 0.3, 0.55, 0.75, 1],
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Number(v.toFixed(3));

export function capIndex(p: number): number {
  let i = 0;
  for (let k = 1; k < 5; k++) if (p >= (HERO.capB[k] as number)) i = k;
  return i;
}

export function stepIndex(p: number): number {
  let i = 0;
  for (let k = 1; k < 4; k++) if (p >= (HERO.stepsP[k] as number)) i = k;
  return i;
}

/** The time of the clip for a progress of the scroll. */
export function tFromP(p: number): number {
  const P = HERO.stepsP;
  const T = HERO.stepsT;
  const k = stepIndex(p);
  const end = k === 3 ? HERO.hold : (P[k + 1] as number);
  const f = clamp01((p - (P[k] as number)) / (end - (P[k] as number)));
  return (T[k] as number) + f * ((T[k + 1] as number) - (T[k] as number));
}

/** The stops of the "switch" that darkens the still frame at 93-100 % of the track: [position in the last 7 %, level]. */
const OFF_KEYS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.14, 0.45],
  [0.2, 0.15],
  [0.36, 0.72],
  [0.46, 0.5],
  [0.62, 0.8],
  [1, 1],
];

/** How dark the still frame is at the end of the track (0 clear, 1 dark): the lamp flickers on, DESIGN_SYSTEM 4. */
export function offAt(p: number): number {
  const x = (p - 0.93) / 0.07;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  for (let i = 1; i < OFF_KEYS.length; i++) {
    const [x1, y1] = OFF_KEYS[i] as readonly [number, number];
    if (x <= x1) {
      const [x0, y0] = OFF_KEYS[i - 1] as readonly [number, number];
      return round3(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
  }
  return 1;
}

/** The slow approach of the held frame: eased from 0 to 1 over the last 8 % of the track. */
export function zoomAt(p: number): number {
  const z = clamp01((p - HERO.hold) / (1 - HERO.hold));
  return round3(z * z * (3 - 2 * z));
}

/** Where a clip that stopped inside a dissolve goes: the nearest clean frame, a little outside the dissolve. */
export function magnetTarget(t: number): number {
  for (const [from, to] of HERO.dissolves) {
    if (t > from && t < to) return t - from < to - t ? from - 0.06 : to + 0.06;
  }
  return t;
}

/** One step of the chase of the clip after the scroll: a big jump goes straight to the target, no frames in between. */
export function follow(current: number, target: number): number {
  const d = target - current;
  return Math.abs(d) < 0.004 || Math.abs(d) > 0.6 ? target : current + d * 0.3;
}

/** The frame to seek to and the time that sits in the middle of it (a seek to the exact start may land on the frame before). */
export function frameFor(time: number, duration: number): { frame: number; time: number } {
  const dur = duration > 0 ? duration : (HERO.stepsT[4] as number) + 0.04;
  const frame = Math.min(Math.round(time * HERO.fps), Math.floor(dur * HERO.fps) - 1);
  return { frame, time: frame / HERO.fps + 0.004 };
}

export type VideoColor = "brand" | "orig";

/** Path of the poster of a step inside the media folder: `posters/step01-brand-1280.webp`. */
export function posterPath(step: number, color: VideoColor, size: "m" | "1280" | "1920"): string {
  return `posters/step0${step + 1}-${color}-${size}.webp`;
}

export interface HeroState {
  /** Caption shown: 0 opening, 1..4 the steps. */
  cap: number;
  step: number;
  /** Progress bars of the four steps, 0..1. */
  fill: number[];
  /** Darkness of the still frame at the very end, 0..1. */
  off: number;
  /** Approach of the held frame, 0..1. */
  zoom: number;
  /** The estimate sample is shown next to the caption of the purchase. */
  docOn: boolean;
  /** Time of the clip, seconds. */
  time: number;
}

export function heroState(p: number): HeroState {
  const cap = capIndex(p);
  return {
    cap,
    step: stepIndex(p),
    fill: [0, 1, 2, 3].map((k) => {
      const a = HERO.stepsP[k] as number;
      const b = HERO.stepsP[k + 1] as number;
      return round3(clamp01((p - a) / (b - a)));
    }),
    off: offAt(p),
    zoom: zoomAt(p),
    docOn: cap === 2,
    time: tFromP(p),
  };
}
