import type { BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { buildLogoGeometry, MATERIAL } from "./geometry.ts";
import { geometryData } from "./geometry-data.ts";
import { lockupOutlines, type Point, type Ring, signedArea } from "./outline.ts";
import { CHAMFER, PART_IDS, POCKET_DEPTH } from "./timeline.ts";

const o = lockupOutlines();
const boxes = new WeakMap<readonly Point[], [number, number, number, number]>();
const boxOf = (ring: readonly Point[]) => {
  let b = boxes.get(ring);
  if (!b) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    b = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    boxes.set(ring, b);
  }
  return b;
};
const inRing = (x: number, y: number, ring: readonly Point[]): boolean => {
  const [x0, x1, y0, y1] = boxOf(ring);
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Point;
    const [xj, yj] = ring[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolygon = (x: number, y: number, polygon: readonly Ring[]) =>
  inRing(x, y, polygon[0] as Ring) && !polygon.slice(1).some((h) => inRing(x, y, h));

/** Fraction of grid points on which two inside-tests disagree. */
function mismatch(a: (x: number, y: number) => boolean, b: (x: number, y: number) => boolean): number {
  let bad = 0;
  let total = 0;
  for (let x = -9.13; x < 352; x += 0.83) {
    for (let y = -10.07; y < 83; y += 0.83) {
      total++;
      if (a(x, y) !== b(x, y)) bad++;
    }
  }
  return bad / total;
}

const word = o.wordParts;
const insideSvgWord = (x: number, y: number) => word.some((r) => inRing(x, y, r));
const insideSvgMark = (x: number, y: number) =>
  [o.shelf, o.triLeft, o.triRight, o.line, o.dot].some((r) => inRing(x, y, r));

describe("baked geometry (geometry-data.ts) equals the SVG outline", () => {
  it("the word is the union of its subpaths: same silhouette to the pixel (sampled every 0.83 unit)", () => {
    const baked = (x: number, y: number) => geometryData.word.some((p) => inPolygon(x, y, p));
    expect(mismatch(insideSvgWord, baked)).toBeLessThan(0.0005);
  });

  it("the word has the five letters as polygons, and the e has a hole (its upper counter)", () => {
    expect(geometryData.word).toHaveLength(5);
    expect(geometryData.word.filter((p) => p.length > 1)).toHaveLength(1);
  });

  it("the plate is the rectangle without the lockup: solid exactly where the SVG has no part", () => {
    const baked = (x: number, y: number) => geometryData.plate.some((p) => inPolygon(x, y, p));
    const expected = (x: number, y: number) => !insideSvgMark(x, y) && !insideSvgWord(x, y);
    expect(mismatch(baked, expected)).toBeLessThan(0.0005);
  });

  it("the plate covers more than any frame (9:16 on a phone shows about 700 units of height)", () => {
    const r = geometryData.rect;
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2000);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2000);
    expect(signedArea(geometryData.plate[0]?.[0] as Ring)).not.toBe(0);
  });

  it("keeps the pocket of the e counter as an island of the plate", () => {
    expect(geometryData.plate.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildLogoGeometry", () => {
  const g = buildLogoGeometry();
  const bounds = (geo: BufferGeometry) => {
    geo.computeBoundingBox();
    return geo.boundingBox as NonNullable<BufferGeometry["boundingBox"]>;
  };
  const triangles = (geo: BufferGeometry) => (geo.getAttribute("position")?.count ?? 0) / 3;

  it("makes the five parts and the plate", () => {
    expect(Object.keys(g.parts).sort()).toEqual([...PART_IDS].sort());
    expect(triangles(g.plate)).toBeGreaterThan(100);
  });

  it("every part is as tall as a pocket is deep: from z = -6 to the plate surface z = 0", () => {
    for (const id of PART_IDS) {
      const b = bounds(g.parts[id]);
      expect(b.max.z).toBeCloseTo(0, 5);
      expect(b.min.z).toBeCloseTo(-POCKET_DEPTH, 5);
    }
    const plate = bounds(g.plate);
    expect(plate.max.z).toBeCloseTo(0, 6);
    expect(plate.min.z).toBeCloseTo(-POCKET_DEPTH, 6);
  });

  it("a part fills its pocket: the outline box of the shelf equals the box of the SVG path", () => {
    const b = bounds(g.parts.shelf);
    expect(b.min.x).toBeCloseTo(Math.min(...o.shelf.map((p) => p[0])), 4);
    expect(b.max.x).toBeCloseTo(Math.max(...o.shelf.map((p) => p[0])), 4);
    expect(b.min.y).toBeCloseTo(Math.min(...o.shelf.map((p) => p[1])), 4);
    expect(b.max.y).toBeCloseTo(Math.max(...o.shelf.map((p) => p[1])), 4);
  });

  it("the word fills its pockets: the box of the word equals the box of the SVG subpaths (the chamfer is cut inside)", () => {
    const b = bounds(g.parts.word);
    const pts = word.flat();
    expect(b.min.x).toBeCloseTo(Math.min(...pts.map((p) => p[0])), 1);
    expect(b.max.x).toBeCloseTo(Math.max(...pts.map((p) => p[0])), 1);
    expect(b.max.y).toBeCloseTo(Math.max(...pts.map((p) => p[1])), 1);
  });

  it("chamfers only free edges of the shelf: the bottom (it sits on the triangle) stays sharp, the top gets 1.3 x 45 deg", () => {
    const geo = g.parts.shelf;
    const pos = geo.getAttribute("position");
    const faceYs: number[] = [];
    for (let i = 0; i < (pos?.count ?? 0); i++) {
      if (Math.abs(pos?.getZ(i) ?? 1) < 1e-9) faceYs.push(pos?.getY(i) ?? 0);
    }
    const ys = o.shelf.map((p) => p[1]);
    expect(Math.min(...faceYs)).toBeCloseTo(Math.min(...ys), 4);
    expect(Math.max(...faceYs)).toBeCloseTo(Math.max(...ys) - CHAMFER, 4);
  });

  it("splits the mark into face, accent and chamfer groups: the triangle has the accent and the ink halves", () => {
    const groups = g.parts.tri.groups.map((x) => x.materialIndex);
    expect(groups).toContain(MATERIAL.face);
    expect(groups).toContain(MATERIAL.accentFace);
    expect(groups).toContain(MATERIAL.chamfer);
    expect(groups).toContain(MATERIAL.accentChamfer);
    expect(g.parts.dot.groups.map((x) => x.materialIndex)).toContain(MATERIAL.accentChamfer);
    expect(g.parts.word.groups.map((x) => x.materialIndex)).toEqual(
      expect.arrayContaining([MATERIAL.face, MATERIAL.chamfer, MATERIAL.wall]),
    );
  });

  it("has finite positions and unit normals, groups that cover every vertex", () => {
    for (const geo of [g.plate, ...Object.values(g.parts)]) {
      const pos = geo.getAttribute("position");
      const nor = geo.getAttribute("normal");
      expect(pos?.count).toBe(nor?.count);
      for (let i = 0; i < (pos?.count ?? 0); i++) {
        expect(Number.isFinite(pos?.getX(i))).toBe(true);
        expect(Number.isFinite(pos?.getY(i))).toBe(true);
        expect(Number.isFinite(pos?.getZ(i))).toBe(true);
      }
    }
    for (const id of PART_IDS) {
      const geo = g.parts[id];
      const pos = geo.getAttribute("position");
      const nor = geo.getAttribute("normal");
      for (let i = 0; i < (pos?.count ?? 0); i += 7) {
        const len = Math.hypot(nor?.getX(i) ?? 0, nor?.getY(i) ?? 0, nor?.getZ(i) ?? 0);
        expect(len).toBeCloseTo(1, 4);
      }
      const covered = geo.groups.reduce((s, x) => s + x.count, 0);
      expect(covered).toBe(pos?.count);
    }
  });

  it("stays light: the whole scene is under 12 000 triangles (the concept: about 6.8 thousand)", () => {
    const total = triangles(g.plate) + PART_IDS.reduce((s, id) => s + triangles(g.parts[id]), 0);
    expect(total).toBeGreaterThan(3000);
    expect(total).toBeLessThan(12000);
  });

  it("the apex of the triangle is the lower tip of the triangle part", () => {
    const b = bounds(g.parts.tri);
    expect(b.min.x).toBeLessThanOrEqual(g.apexX);
    expect(b.max.x).toBeGreaterThanOrEqual(g.apexX);
    expect(g.apexX).toBeCloseTo(o.triLeft[2]?.[0] ?? Number.NaN, 9);
  });

  it("the faces of the parts look to the camera (+z) and the backs away", () => {
    const geo = g.parts.line;
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    for (let i = 0; i < (pos?.count ?? 0); i++) {
      if (Math.abs(pos?.getZ(i) ?? 1) < 1e-9 && Math.abs(nor?.getZ(i) ?? 0) > 0.99)
        expect(nor?.getZ(i)).toBeGreaterThan(0);
    }
  });
});
