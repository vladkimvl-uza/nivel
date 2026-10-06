import { describe, expect, it } from "vitest";
import { markShapes, wordShapes } from "../logo/shapes.ts";
import { lockupOutlines, parsePathRings, parseTransform, signedArea, toScene } from "./outline.ts";

describe("parsePathRings", () => {
  it("reads relative lines (h, v) and closes the ring without repeating the first point", () => {
    expect(parsePathRings("M8 16h52v8h-52Z")).toEqual([
      [
        [8, 16],
        [60, 16],
        [60, 24],
        [8, 24],
      ],
    ]);
  });

  it("reads absolute lines and treats extra pairs after M as lines", () => {
    expect(parsePathRings("M8 24L24 24L24 40Z")[0]).toEqual([
      [8, 24],
      [24, 24],
      [24, 40],
    ]);
    expect(parsePathRings("M0 0 10 0 10 10Z")[0]).toHaveLength(3);
  });

  it("cuts a quadratic curve into 16 steps by default and ends exactly on the end point", () => {
    const [ring] = parsePathRings("M0 0Q5 10 10 0L0 -5Z");
    expect(ring).toHaveLength(1 + 16 + 1);
    expect(ring?.[16]).toEqual([10, 0]);
    // the middle of the curve is at t = 0.5: (5, 5)
    expect(ring?.[8]).toEqual([5, 5]);
    expect(parsePathRings("M0 0Q5 10 10 0L0 -5Z", 4)[0]).toHaveLength(1 + 4 + 1);
  });

  it("splits subpaths and accepts relative m and q", () => {
    const rings = parsePathRings("M0 0h4v4h-4ZM10 10h4v4h-4Z");
    expect(rings).toHaveLength(2);
    expect(rings[1]?.[0]).toEqual([10, 10]);
    expect(parsePathRings("m1 1h2v2h-2z")[0]?.[0]).toEqual([1, 1]);
    expect(parsePathRings("M0 0q2 4 4 0l0 -3z")[0]?.at(-1)).toEqual([4, -3]);
  });

  it("reads numbers glued by signs, like -31.65Q43.65-34.75", () => {
    const rings = parsePathRings("M44.35 0V-26Q44.35 -28.55 44 -31.65H40Z");
    expect(rings[0]?.[1]).toEqual([44.35, -26]);
    expect(rings[0]?.at(-1)).toEqual([40, -31.65]);
  });

  it("refuses a command it does not know (no silent wrong picture)", () => {
    expect(() => parsePathRings("M0 0C1 1 2 2 3 3Z")).toThrow(/unsupported command C/);
    expect(() => parsePathRings("M0 0L1")).toThrow(/number is expected/);
  });

  it("drops a ring that has fewer than three points", () => {
    expect(parsePathRings("M0 0L1 1Z")).toEqual([]);
  });
});

describe("transforms and area", () => {
  it("reads translate and scale as written in the lockup", () => {
    expect(parseTransform("translate(-6.25 -74.97) scale(1.5619)")).toEqual({ tx: -6.25, ty: -74.97, scale: 1.5619 });
    expect(parseTransform("translate(111.56 0)")).toEqual({ tx: 111.56, ty: 0, scale: 1 });
    expect(parseTransform("")).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it("moves rings to the scene: scale, shift, then Y up", () => {
    const [ring] = toScene([[[10, 20]]], "translate(1 2) scale(2)");
    expect(ring).toEqual([[21, -42]]);
  });

  it("has a positive area for a counter-clockwise ring in Y up", () => {
    expect(
      signedArea([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(4);
    expect(
      signedArea([
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ]),
    ).toBe(-4);
  });
});

describe("outlines of nivel-1-lockup.svg", () => {
  const o = lockupOutlines();
  const box = (r: readonly (readonly [number, number])[]) => ({
    x0: Math.min(...r.map((p) => p[0])),
    x1: Math.max(...r.map((p) => p[0])),
    y0: Math.min(...r.map((p) => p[1])),
    y1: Math.max(...r.map((p) => p[1])),
  });

  it("has the six paths of the lockup: four mark rings (shelf, two triangle halves, line), a dot and the word subpaths", () => {
    expect([o.shelf.length, o.triLeft.length, o.triRight.length, o.line.length, o.dot.length]).toEqual([4, 3, 3, 4, 3]);
    expect(o.wordParts).toHaveLength(7);
    expect(markShapes).toHaveLength(4);
    expect(wordShapes).toHaveLength(2);
  });

  it("puts the mark in lockup coordinates: shelf 8..60 x 16..24 of the mark, scaled 1.5619, Y up", () => {
    const b = box(o.shelf);
    expect(b.x0).toBeCloseTo(8 * 1.5619 - 6.25, 6);
    expect(b.x1).toBeCloseTo(60 * 1.5619 - 6.25, 6);
    expect(b.y1).toBeCloseTo(-(16 * 1.5619 - 74.97), 6);
    expect(b.y0).toBeCloseTo(-(24 * 1.5619 - 74.97), 6);
  });

  it("joins the mark parts as the brand mark does: the shelf sits on the triangle, the apex touches the line", () => {
    const shelf = box(o.shelf);
    const tri = box([...o.triLeft, ...o.triRight]);
    const line = box(o.line);
    expect(tri.y1).toBeCloseTo(shelf.y0, 6);
    expect(tri.y0).toBeCloseTo(line.y1, 6);
    // the two halves share the seam at x = 24 of the mark
    const seam = 24 * 1.5619 - 6.25;
    expect(o.triLeft[1]?.[0]).toBeCloseTo(seam, 6);
    expect(box(o.triRight).x0).toBeCloseTo(seam, 6);
  });

  it("puts the word right of the mark and the dot over the i", () => {
    const word = box(o.wordParts.flat());
    expect(word.x0).toBeGreaterThan(box(o.line).x1);
    const d = box(o.dot);
    expect(d.y0).toBeGreaterThan(word.y1 - 25);
    expect(d.x0).toBeGreaterThan(box(o.wordParts[2] ?? []).x0 - 20);
  });

  it("fits the viewBox -4 -77.5 348.6 83 (the lockup box) with Y up", () => {
    const all = box([o.shelf, o.triLeft, o.triRight, o.line, o.dot, ...o.wordParts].flat());
    expect(all.x0).toBeGreaterThanOrEqual(-4 - 1e-6);
    expect(all.x1).toBeLessThanOrEqual(-4 + 348.6 + 1e-6);
    expect(all.y0).toBeGreaterThanOrEqual(-5.5 - 1e-6);
    expect(all.y1).toBeLessThanOrEqual(77.5 + 1e-6);
  });
});
