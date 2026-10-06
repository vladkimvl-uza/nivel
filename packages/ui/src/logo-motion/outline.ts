// Outlines of the logo as polygons: the SVG paths of src/logo/shapes.ts, flattened (curves cut into 16 steps, as
// three's SVGLoader does) and moved to the scene coordinates of the lockup (Y up). No three, no DOM.
import { type LogoShape, lockupMarkTransform, lockupWordTransform, markShapes, wordShapes } from "../logo/shapes.ts";

export type Point = readonly [number, number];
export type Ring = Point[];

const TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

/**
 * Flattens path data into closed rings (the first point is not repeated at the end). Supports M, L, H, V, Q and Z,
 * absolute and relative, which is all that the brand files use; any other command throws.
 */
export function parsePathRings(d: string, divisions = 16): Ring[] {
  const tokens = d.match(TOKEN) ?? [];
  const rings: Ring[] = [];
  let ring: Point[] = [];
  let x = 0;
  let y = 0;
  let cmd = "";
  let i = 0;
  const num = (): number => {
    const token = tokens[i++];
    const value = Number(token);
    if (token === undefined || Number.isNaN(value)) throw new Error(`parsePathRings: a number is expected at ${i - 1}`);
    return value;
  };
  const push = (px: number, py: number) => {
    const last = ring[ring.length - 1];
    if (!last || last[0] !== px || last[1] !== py) ring.push([px, py]);
    x = px;
    y = py;
  };
  const close = () => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1] && ring.length > 1) ring.pop();
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        const start = ring[0];
        close();
        if (start) {
          x = start[0];
          y = start[1];
        }
        continue;
      }
    } else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": {
        if (ring.length) close();
        const px = ox + num();
        const py = oy + num();
        push(px, py);
        break;
      }
      case "L": {
        const px = ox + num();
        const py = oy + num();
        push(px, py);
        break;
      }
      case "H":
        push(ox + num(), y);
        break;
      case "V":
        push(x, oy + num());
        break;
      case "Q": {
        const cx = ox + num();
        const cy = oy + num();
        const px = ox + num();
        const py = oy + num();
        const x0 = x;
        const y0 = y;
        for (let s = 1; s <= divisions; s++) {
          const u = s / divisions;
          const a = (1 - u) * (1 - u);
          const b = 2 * (1 - u) * u;
          const c = u * u;
          push(a * x0 + b * cx + c * px, a * y0 + b * cy + c * py);
        }
        break;
      }
      default:
        throw new Error(`parsePathRings: unsupported command ${cmd}`);
    }
  }
  if (ring.length) close();
  return rings;
}

/** `translate(tx ty) scale(s)` as in the lockup groups (the only transforms of the brand files). */
export function parseTransform(transform: string): { tx: number; ty: number; scale: number } {
  const tr = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(transform);
  const sc = /scale\(\s*([-\d.]+)\s*\)/.exec(transform);
  return { tx: Number(tr?.[1] ?? 0), ty: Number(tr?.[2] ?? 0), scale: Number(sc?.[1] ?? 1) };
}

/** Applies the transform of a lockup group and turns Y up (the scene has Y up, SVG has Y down). */
export function toScene(rings: Ring[], transform: string): Ring[] {
  const { tx, ty, scale } = parseTransform(transform);
  return rings.map((r) => r.map(([px, py]): Point => [px * scale + tx, -(py * scale + ty)]));
}

/** Signed area; positive for a counter-clockwise ring (Y up). */
export function signedArea(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

const ringsOf = (shapes: readonly LogoShape[], transform: string): Ring[] =>
  shapes.flatMap((s) => toScene(parsePathRings(s.d), transform));

export interface LockupOutlines {
  /** Shelf of the mark. */
  shelf: Ring;
  /** The two halves of the level triangle: `triLeft` is the accent one (A, B, C), `triRight` is the ink one. */
  triLeft: Ring;
  triRight: Ring;
  /** The level line under the mark. */
  line: Ring;
  /** The dot over i. */
  dot: Ring;
  /** Subpaths of the word before the union (n and e are built from overlapping subpaths). */
  wordParts: Ring[];
}

/** The six paths of nivel-1-lockup.svg as scene polygons (Y up). */
export function lockupOutlines(): LockupOutlines {
  const mark = ringsOf(markShapes, lockupMarkTransform);
  const word = wordShapes.map((s) => ringsOf([s], lockupWordTransform));
  const [shelf, triLeft, triRight, line] = mark as [Ring, Ring, Ring, Ring];
  return { shelf, triLeft, triRight, line, dot: (word[1] as Ring[])[0] as Ring, wordParts: word[0] as Ring[] };
}
