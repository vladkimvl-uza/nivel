// Meshes of the intro: five parts of the lockup and the milled plate with pockets along its contour.
// Needs three but no renderer and no DOM, so it runs in Node (tests). The outlines come from the SVG of the logo
// (outline.ts), the unions come baked (geometry-data.ts).
import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Path, Shape, Vector2, Vector3 } from "three";
import { geometryData } from "./geometry-data.ts";
import { lockupOutlines, type Point, type Ring, signedArea } from "./outline.ts";
import { CHAMFER, type PartId, POCKET_DEPTH } from "./timeline.ts";

/** Material slots of a part geometry: the order of the `materials` array in the scene. */
export const MATERIAL = { face: 0, accentFace: 1, chamfer: 2, wall: 3, accentChamfer: 4 } as const;

export interface LogoGeometry {
  plate: BufferGeometry;
  parts: Record<PartId, BufferGeometry>;
  /** X of the apex of the level triangle (the layout axis of the triangle runs through it). */
  apexX: number;
}

type Tri = [Point3, Point3, Point3, Point3];
type Point3 = readonly [number, number, number];

/** Triangle soup with a material group per kind of face. */
class Builder {
  private readonly lists: Tri[][] = [[], [], [], [], []];

  tri(a: Point3, b: Point3, c: Point3, group: number, hint?: Point3): void {
    const A = new Vector3(...a);
    const B = new Vector3(...b);
    const C = new Vector3(...c);
    const n = new Vector3().subVectors(B, A).cross(new Vector3().subVectors(C, A));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    let second = b;
    let third = c;
    if (hint && n.dot(new Vector3(...hint)) < 0) {
      second = c;
      third = b;
      n.negate();
    }
    (this.lists[group] as Tri[]).push([a, second, third, [n.x, n.y, n.z]]);
  }

  quad(a: Point3, b: Point3, c: Point3, d: Point3, group: number, hint?: Point3): void {
    this.tri(a, b, c, group, hint);
    this.tri(a, c, d, group, hint);
  }

  geometry(): BufferGeometry {
    const position: number[] = [];
    const normal: number[] = [];
    const out = new BufferGeometry();
    let start = 0;
    this.lists.forEach((list, material) => {
      for (const [a, b, c, n] of list) {
        position.push(...a, ...b, ...c);
        for (let k = 0; k < 3; k++) normal.push(...n);
      }
      if (list.length) out.addGroup(start, list.length * 3, material);
      start += list.length * 3;
    });
    out.setAttribute("position", new Float32BufferAttribute(position, 3));
    out.setAttribute("normal", new Float32BufferAttribute(normal, 3));
    out.computeBoundingBox();
    return out;
  }
}

const ccw = (r: Ring): Ring => (signedArea(r) < 0 ? [...r].reverse() : r);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * Convex prism with a chamfer on the chosen edges only. Mating edges (shelf bottom, triangle top, the colour seam)
 * stay sharp, so the seated mark reads as one "flag", not three parts. The face is at z = 0, the back at -depth.
 */
function prism(builder: Builder, ring: Ring, chamfered: (p: Point, q: Point) => boolean, accent = false): void {
  const r = ccw(ring);
  const n = r.length;
  const pt = (i: number) => r[i % n] as Point;
  const off = r.map((p, i) => (chamfered(p, pt(i + 1)) ? CHAMFER : 0));
  // inward normals of the edges
  const nrm = r.map((p, i): [number, number] => {
    const q = pt(i + 1);
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dx, dy);
    return [-dy / l, dx / l];
  });
  const inset = r.map((p, i): [number, number] => {
    const j = (i - 1 + n) % n; // the lines of edges j and i meet at the vertex i
    const [a1, b1] = nrm[j] as [number, number];
    const c1 = a1 * pt(j)[0] + b1 * pt(j)[1] + (off[j] as number);
    const [a2, b2] = nrm[i] as [number, number];
    const c2 = a2 * p[0] + b2 * p[1] + (off[i] as number);
    const det = a1 * b2 - a2 * b1;
    return [(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det];
  });
  const gFace = accent ? MATERIAL.accentFace : MATERIAL.face;
  const gChamfer = accent ? MATERIAL.accentChamfer : MATERIAL.chamfer;
  const gWall = accent ? MATERIAL.accentFace : MATERIAL.wall;
  const at = (p: readonly [number, number], z: number): Point3 => [p[0], p[1], z];
  for (let i = 1; i < n - 1; i++) {
    builder.tri(
      at(inset[0] as [number, number], 0),
      at(inset[i] as [number, number], 0),
      at(inset[i + 1] as [number, number], 0),
      gFace,
      [0, 0, 1],
    );
  }
  for (let i = 1; i < n - 1; i++) {
    builder.tri(
      at(r[0] as Point, -POCKET_DEPTH),
      at(pt(i), -POCKET_DEPTH),
      at(pt(i + 1), -POCKET_DEPTH),
      gWall,
      [0, 0, -1],
    );
  }
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const nr = nrm[i] as [number, number];
    const out: Point3 = [-nr[0], -nr[1], 0];
    const slanted = (off[i] as number) > 0;
    builder.quad(
      at(inset[i] as [number, number], 0),
      at(inset[k] as [number, number], 0),
      at(pt(k), -CHAMFER),
      at(pt(i), -CHAMFER),
      slanted ? gChamfer : gWall,
      slanted ? [out[0], out[1], 1] : out,
    );
    builder.quad(
      at(pt(i), -CHAMFER),
      at(pt(k), -CHAMFER),
      at(pt(k), -POCKET_DEPTH),
      at(pt(i), -POCKET_DEPTH),
      gWall,
      out,
    );
  }
}

/** Curved outlines (the word): ExtrudeGeometry with the chamfer cut inside the contour, regrouped by face kind. */
function extruded(shapes: Shape[]): BufferGeometry {
  const g = new ExtrudeGeometry(shapes, {
    depth: POCKET_DEPTH - 2 * CHAMFER,
    bevelEnabled: true,
    bevelThickness: CHAMFER,
    bevelSize: CHAMFER,
    bevelOffset: -CHAMFER,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.computeBoundingBox();
  g.translate(0, 0, -(g.boundingBox?.max.z ?? 0));
  const pos = g.attributes.position;
  const builder = new Builder();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const t = new Vector3();
  if (!pos) throw new Error("extruded: no position attribute");
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(t.subVectors(c, a)).normalize();
    const nz = Math.abs(n.z);
    const group = nz > 0.95 ? MATERIAL.face : nz > 0.2 ? MATERIAL.chamfer : MATERIAL.wall;
    builder.tri(
      a.toArray() as unknown as Point3,
      b.toArray() as unknown as Point3,
      c.toArray() as unknown as Point3,
      group,
    );
  }
  g.dispose();
  return builder.geometry();
}

const v2 = ([x, y]: Point) => new Vector2(x, y);
function shapeOf(polygon: readonly Ring[]): Shape {
  const [outer, ...holes] = polygon as [Ring, ...Ring[]];
  const shape = new Shape(outer.map(v2));
  for (const h of holes) shape.holes.push(new Path(h.map(v2)));
  return shape;
}

/** Builds the five parts and the plate; pockets are the exact contour of the lockup (the seated silhouette equals the SVG). */
export function buildLogoGeometry(): LogoGeometry {
  const o = lockupOutlines();
  const shelfMinY = Math.min(...o.shelf.map((p) => p[1]));
  const topY = (o.triLeft[0] as Point)[1];
  const seamX = (o.triLeft[1] as Point)[0];
  const apex = o.triLeft[2] as Point;

  const shelf = new Builder();
  prism(shelf, o.shelf, (p, q) => !(near(p[1], shelfMinY) && near(q[1], shelfMinY)));
  const tri = new Builder();
  const sharp = (p: Point, q: Point) =>
    (near(p[1], topY) && near(q[1], topY)) || (near(p[0], seamX) && near(q[0], seamX));
  prism(tri, o.triLeft, (p, q) => !sharp(p, q), true);
  prism(tri, o.triRight, (p, q) => !sharp(p, q), false);
  const line = new Builder();
  prism(line, o.line, () => true);
  const dot = new Builder();
  prism(dot, o.dot, () => true, true);

  const plate = new ExtrudeGeometry(geometryData.plate.map(shapeOf), {
    depth: POCKET_DEPTH,
    bevelEnabled: false,
    curveSegments: 1,
  });
  plate.translate(0, 0, -POCKET_DEPTH);

  return {
    plate,
    parts: {
      line: line.geometry(),
      tri: tri.geometry(),
      shelf: shelf.geometry(),
      word: extruded(geometryData.word.map(shapeOf)),
      dot: dot.geometry(),
    },
    apexX: apex[0],
  };
}
