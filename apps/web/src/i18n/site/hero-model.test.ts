import { describe, expect, it } from "vitest";
import {
  capIndex,
  follow,
  frameFor,
  HERO,
  heroState,
  magnetTarget,
  offAt,
  posterPath,
  stepIndex,
  tFromP,
  zoomAt,
} from "./hero-model.ts";

describe("the montage of the first screen (v2, 14.04 s, 25 fps)", () => {
  it("has four steps that cover the whole scroll and the whole clip", () => {
    expect(HERO.stepsP).toEqual([0, 0.3, 0.55, 0.75, 1]);
    expect(HERO.stepsT).toEqual([0, 3.68, 7.76, 10.44, 14.0]);
    expect(HERO.capB).toEqual([0, 0.11, 0.3, 0.55, 0.75, 1]);
    expect(HERO.hold).toBe(0.92);
    expect(HERO.fps).toBe(25);
  });
});

describe("capIndex and stepIndex", () => {
  it.each([
    [0, 0],
    [0.109, 0],
    [0.11, 1],
    [0.29, 1],
    [0.3, 2],
    [0.549, 2],
    [0.55, 3],
    [0.749, 3],
    [0.75, 4],
    [1, 4],
  ])("the caption at %d is %d", (p, i) => {
    expect(capIndex(p)).toBe(i);
  });

  it.each([
    [0, 0],
    [0.299, 0],
    [0.3, 1],
    [0.549, 1],
    [0.55, 2],
    [0.75, 3],
    [1, 3],
  ])("the step at %d is %d", (p, i) => {
    expect(stepIndex(p)).toBe(i);
  });
});

describe("tFromP: scroll to the time of the clip", () => {
  it.each([
    [0, 0],
    [0.3, 3.68],
    [0.55, 7.76],
    [0.75, 10.44],
    [HERO.hold, 14.0],
    [1, 14.0],
  ])("at %d the clip is at %d s", (p, t) => {
    expect(tFromP(p)).toBeCloseTo(t, 6);
  });

  it("goes linearly inside a step", () => {
    expect(tFromP(0.15)).toBeCloseTo(1.84, 6);
    expect(tFromP(0.425)).toBeCloseTo((3.68 + 7.76) / 2, 6);
  });

  it("holds the last frame in the last 8 percent of the scroll", () => {
    expect(tFromP(0.95)).toBeCloseTo(14.0, 6);
    expect(tFromP(0.84)).toBeCloseTo(10.44 + ((0.84 - 0.75) / (0.92 - 0.75)) * (14 - 10.44), 6);
  });

  it("clamps what is out of range", () => {
    expect(tFromP(-1)).toBe(0);
    expect(tFromP(7)).toBe(14);
  });
});

describe("offAt: the still frame goes out like a switch at the end of the track", () => {
  it("is zero before 93 percent and one at the end", () => {
    expect(offAt(0)).toBe(0);
    expect(offAt(0.93)).toBe(0);
    expect(offAt(1)).toBe(1);
    expect(offAt(2)).toBe(1);
  });

  it("flickers on like a lamp: up, down, up (DESIGN_SYSTEM 4)", () => {
    const [first, dip, rise] = [0.9398, 0.944, 0.9552].map(offAt);
    expect(first).toBeCloseTo(0.45, 2);
    expect(dip).toBeCloseTo(0.15, 2);
    expect(rise).toBeGreaterThan(0.6);
  });

  it("rounds to three digits", () => {
    expect(String(offAt(0.9501)).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });
});

describe("zoomAt", () => {
  it("is still until the hold, then eases in to one", () => {
    expect(zoomAt(0.5)).toBe(0);
    expect(zoomAt(HERO.hold)).toBe(0);
    expect(zoomAt(1)).toBe(1);
    expect(zoomAt(0.96)).toBeCloseTo(0.5, 6);
  });
});

describe("magnetTarget: after the scroll stops inside a dissolve the nearest clean frame is shown", () => {
  it("leaves a clean time alone", () => {
    expect(magnetTarget(1)).toBe(1);
    expect(magnetTarget(3.5)).toBe(3.5);
    expect(magnetTarget(3.84)).toBe(3.84);
  });

  it("snaps the first half of a dissolve back and the second half forward", () => {
    expect(magnetTarget(3.6)).toBeCloseTo(3.52 - 0.06, 6);
    expect(magnetTarget(3.8)).toBeCloseTo(3.84 + 0.06, 6);
    expect(magnetTarget(7.7)).toBeCloseTo(7.6 - 0.06, 6);
    expect(magnetTarget(10.5)).toBeCloseTo(10.6 + 0.06, 6);
  });
});

describe("follow: the clip chases the scroll", () => {
  it("jumps to the target on a big jump and when close, and eases in between", () => {
    expect(follow(0, 5)).toBe(5);
    expect(follow(1, 1.002)).toBe(1.002);
    expect(follow(1, 1.3)).toBeCloseTo(1.09, 6);
    expect(follow(1.3, 1)).toBeCloseTo(1.21, 6);
  });
});

describe("frameFor", () => {
  it("picks the frame and a time in the middle of it", () => {
    expect(frameFor(0, 14.04).frame).toBe(0);
    expect(frameFor(0, 14.04).time).toBeCloseTo(0.004, 9);
    expect(frameFor(1, 14.04).frame).toBe(25);
    expect(frameFor(1, 14.04).time).toBeCloseTo(1.004, 9);
    expect(frameFor(14, 14.04).frame).toBe(350);
  });

  it("never asks for a frame after the last", () => {
    expect(frameFor(99, 14.04).frame).toBe(350);
    expect(frameFor(99, 0).frame).toBeGreaterThanOrEqual(0);
  });

  it("uses the length of the montage while the clip has not told its own", () => {
    expect(frameFor(99, Number.NaN).frame).toBe(Math.floor((14.0 + 0.04) * 25) - 1);
  });
});

describe("posterPath", () => {
  it("names the poster of a step in a colour and a size", () => {
    expect(posterPath(0, "brand", "1280")).toBe("posters/step01-brand-1280.webp");
    expect(posterPath(3, "brand", "m")).toBe("posters/step04-brand-m.webp");
    expect(posterPath(1, "orig", "1920")).toBe("posters/step02-orig-1920.webp");
  });
});

describe("heroState", () => {
  it("shows the opening caption and the first step at the top", () => {
    expect(heroState(0)).toMatchObject({ cap: 0, step: 0, off: 0, zoom: 0, docOn: false });
    expect(heroState(0).fill).toEqual([0, 0, 0, 0]);
  });

  it("shows the estimate sample next to the caption of the purchase", () => {
    expect(heroState(0.4)).toMatchObject({ cap: 2, step: 1, docOn: true });
    expect(heroState(0.2).docOn).toBe(false);
    expect(heroState(0.6).docOn).toBe(false);
  });

  it("fills the progress of each step from its own start to its own end", () => {
    const s = heroState(0.425);
    expect(s.fill[0]).toBe(1);
    expect(s.fill[1]).toBeCloseTo(0.5, 6);
    expect(s.fill[2]).toBe(0);
    expect(heroState(1).fill).toEqual([1, 1, 1, 1]);
  });

  it("carries the time of the clip", () => {
    expect(heroState(0.3).time).toBeCloseTo(3.68, 6);
  });
});
