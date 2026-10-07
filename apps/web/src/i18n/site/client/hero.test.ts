import { describe, expect, it } from "vitest";
import { heroState } from "../hero-model.ts";
import type { ElLike } from "./dom.ts";
import { applyHero, createHeroMemo, type HeroApplyEls, posterToShow, progressOf } from "./hero.ts";

type FakeEl = ElLike & { classes: Set<string>; style: ElLike["style"] & Record<string, string> };

function el(): FakeEl {
  const classes = new Set<string>();
  const style: Record<string, unknown> = { opacity: "", transform: "" };
  style.setProperty = (k: string, v: string) => {
    style[k] = v;
  };
  return {
    classes,
    classList: {
      add: (...n: string[]) => {
        for (const x of n) classes.add(x);
      },
      remove: (...n: string[]) => {
        for (const x of n) classes.delete(x);
      },
      toggle: (n: string, force?: boolean) => {
        const on = force ?? !classes.has(n);
        if (on) classes.add(n);
        else classes.delete(n);
        return on;
      },
      contains: (n: string) => classes.has(n),
    },
    style: style as FakeEl["style"],
    textContent: "",
    setAttribute: () => {},
  };
}

function els() {
  const caps = [0, 1, 2, 3, 4].map(el);
  const steps = [0, 1, 2, 3].map(el);
  const fills = [0, 1, 2, 3].map(el);
  const hdoc = el();
  const stepsNow = el();
  const off = el();
  const hfoot = el();
  const media = el();
  return { caps, steps, fills, hdoc, stepsNow, off, hfoot, media } satisfies HeroApplyEls;
}

const text = (step: number) => `0${step + 1} / 04`;

describe("applyHero", () => {
  it("shows the caption and the step of the progress and sets the fills", () => {
    const e = els();
    const shown: number[] = [];
    applyHero(e, heroState(0.4), createHeroMemo(), text, (step) => shown.push(step));
    expect(e.caps.map((c) => c.classes.has("is-on"))).toEqual([false, false, true, false, false]);
    expect(e.steps.map((c) => c.classes.has("is-on"))).toEqual([true, true, false, false]);
    expect(e.fills[0]?.style.transform).toBe("scaleX(1)");
    expect(e.fills[1]?.style.transform).toBe("scaleX(0.4)");
    expect(e.fills[2]?.style.transform).toBe("scaleX(0)");
    expect(e.hdoc?.classes.has("is-on")).toBe(true);
    expect(e.stepsNow.textContent).toBe("02 / 04");
    expect(shown).toEqual([1]);
  });

  it("shows the poster only when the step changes", () => {
    const e = els();
    const memo = createHeroMemo();
    const shown: number[] = [];
    applyHero(e, heroState(0.31), memo, text, (s) => shown.push(s));
    applyHero(e, heroState(0.33), memo, text, (s) => shown.push(s));
    applyHero(e, heroState(0.56), memo, text, (s) => shown.push(s));
    expect(shown).toEqual([1, 2]);
  });

  it("does not touch the captions when only the fill changed", () => {
    const e = els();
    const memo = createHeroMemo();
    applyHero(e, heroState(0.31), memo, text, () => {});
    const c = e.caps[1];
    c?.classes.delete("is-on"); // a mark that would come back if the caption were written again
    applyHero(e, heroState(0.33), memo, text, () => {});
    expect(c?.classes.has("is-on")).toBe(false);
  });

  it("darkens the still frame and fades the footer at the end of the track, and zooms in", () => {
    const e = els();
    applyHero(e, heroState(1), createHeroMemo(), text, () => {});
    expect(e.off.style.opacity).toBe("1");
    expect(e.hfoot.style.opacity).toBe("0.000");
    expect(e.media.style["--z"]).toBe("1");
  });

  it("leaves the stage clear in the middle of the track", () => {
    const e = els();
    applyHero(e, heroState(0.5), createHeroMemo(), text, () => {});
    expect(e.off.style.opacity).toBe("0");
    expect(e.hfoot.style.opacity).toBe("1.000");
  });

  it("works without the estimate sample", () => {
    const e = { ...els(), hdoc: null };
    expect(() => applyHero(e, heroState(0.4), createHeroMemo(), text, () => {})).not.toThrow();
  });
});

describe("posterToShow", () => {
  it("shows the poster of the step and, on a poster-only page, loads the next one too", () => {
    expect(posterToShow(0, "posters")).toEqual({ show: 0, load: [0, 1] });
    expect(posterToShow(2, "posters")).toEqual({ show: 2, load: [2, 3] });
    expect(posterToShow(3, "posters")).toEqual({ show: 3, load: [3] });
  });

  it("loads only the poster of the step while the video is expected to play", () => {
    expect(posterToShow(1, "video")).toEqual({ show: 1, load: [1] });
  });
});

describe("progressOf", () => {
  it("is the share of the track that has gone above the window", () => {
    expect(progressOf({ top: 0, height: 5200 }, 1000)).toBe(0);
    expect(progressOf({ top: -2100, height: 5200 }, 1000)).toBeCloseTo(0.5, 6);
    expect(progressOf({ top: -4200, height: 5200 }, 1000)).toBe(1);
  });

  it("is clamped before the track and after it", () => {
    expect(progressOf({ top: 300, height: 5200 }, 1000)).toBe(0);
    expect(progressOf({ top: -9999, height: 5200 }, 1000)).toBe(1);
  });

  it("does not divide by zero when the track is not taller than the window", () => {
    expect(progressOf({ top: -10, height: 800 }, 1000)).toBe(1);
    expect(progressOf({ top: 0, height: 800 }, 1000)).toBe(0);
  });
});
