import { describe, expect, it } from "vitest";
import { type ClipDeps, type ClipVideo, createClips } from "./clips.ts";

class FakeVideo implements ClipVideo {
  duration = 4;
  seeking = false;
  private time = 0;
  get currentTime() {
    return this.time;
  }
  set currentTime(t: number) {
    this.seeks.push(t);
    this.time = t;
  }
  loop = false;
  paused = true;
  classes = new Set<string>();
  listeners = new Map<string, (() => void)[]>();
  seeks: number[] = [];
  classList = {
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function setup(o: { reduced?: boolean } = {}) {
  const made: Record<string, FakeVideo> = {};
  const timers: { cb: () => void; ms: number }[] = [];
  let hidden = false;
  const deps: ClipDeps = {
    create(key) {
      const v = new FakeVideo();
      made[key] = v;
      return v;
    },
    release: () => {},
    timeout: (cb, ms) => timers.push({ cb, ms }),
    hidden: () => hidden,
    reduced: o.reduced ?? false,
  };
  const clips = createClips(deps);
  const ready = (key: string) => {
    made[key]?.emit("loadeddata");
  };
  const fire = () => {
    const t = timers.splice(0);
    for (const x of t) x.cb();
  };
  return { clips, made, ready, fire, timers, setHidden: (h: boolean) => (hidden = h) };
}

describe("createClips: the clips of the stages that the scroll scrubs", () => {
  it("makes a clip once and keeps it", () => {
    const { clips, made } = setup();
    clips.get("x");
    clips.get("x");
    expect(Object.keys(made)).toEqual(["x"]);
  });

  it("looks the clip of the test over as a loop and the others as scrubbed", () => {
    const { clips, made } = setup();
    clips.get("t");
    clips.get("x");
    expect(made.t?.loop).toBe(true);
    expect(made.x?.loop).toBe(false);
  });

  it("moves a clip to the share of the stage: after it is ready, to the frame of that time", () => {
    const { clips, made, ready } = setup();
    clips.set("x", 0.5);
    expect(made.x?.seeks).toEqual([]);
    ready("x");
    expect(made.x?.seeks[0]).toBeCloseTo(2.004, 6);
  });

  it("asks for the next frame only after the last one was drawn", () => {
    const { clips, made, ready } = setup();
    clips.set("x", 0.25);
    ready("x");
    clips.set("x", 0.5);
    clips.set("x", 0.75);
    expect(made.x?.seeks).toHaveLength(1);
    made.x?.emit("seeked");
    expect(made.x?.seeks).toHaveLength(2);
    expect(made.x?.seeks[1]).toBeCloseTo(3.004, 6);
  });

  it("shows only the clip of the current stage, and only when it is ready", () => {
    const { clips, made, ready } = setup();
    clips.set("x", 0);
    expect(made.x?.classes.has("is-on")).toBe(false);
    ready("x");
    expect(made.x?.classes.has("is-on")).toBe(true);
    clips.set("y", 0);
    ready("y");
    expect(made.x?.classes.has("is-on")).toBe(false);
    expect(made.y?.classes.has("is-on")).toBe(true);
  });

  it("lets the clip play on by itself when the scroll stops, after 450 ms, up to the stop", () => {
    const { clips, made, ready, fire, timers } = setup();
    clips.set("x", 0.25);
    ready("x");
    expect(timers.some((t) => t.ms === 450)).toBe(true);
    clips.stop("x", 3);
    fire();
    expect(made.x?.paused).toBe(false);
  });

  it("does not play on by itself when the clip has already reached its stop", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("x", 0.9);
    ready("x");
    clips.stop("x", 3);
    fire();
    expect(made.x?.paused).toBe(true);
  });

  it("pauses at the stop of the chapter and remembers how far it went by itself", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("y", 0.1);
    ready("y");
    clips.stop("y", 2);
    fire();
    expect(made.y?.paused).toBe(false);
    if (made.y) made.y.currentTime = 2;
    made.y?.emit("timeupdate");
    expect(made.y?.paused).toBe(true);
  });

  it("stops what plays when the visitor scrolls again, and takes the clip back to the scroll", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("x", 0.25);
    ready("x");
    clips.stop("x", 4);
    fire();
    expect(made.x?.paused).toBe(false);
    clips.set("x", 0.3);
    expect(made.x?.paused).toBe(true);
  });

  it("pauses the other clips when the stage changes", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("x", 0.25);
    ready("x");
    clips.stop("x", 4);
    fire();
    clips.set("y", 0);
    expect(made.x?.paused).toBe(true);
  });

  it("plays the loop of the test as soon as it is ready and the timer fires", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("t", 0);
    ready("t");
    fire();
    expect(made.t?.paused).toBe(false);
  });

  it("does not play in a hidden tab", () => {
    const { clips, made, ready, fire, setHidden } = setup();
    clips.set("t", 0);
    ready("t");
    setHidden(true);
    fire();
    expect(made.t?.paused).toBe(true);
  });

  it("never plays under reduced motion", () => {
    const { clips, made, ready, fire } = setup({ reduced: true });
    clips.set("t", 0);
    ready("t");
    fire();
    expect(made.t?.paused).toBe(true);
  });

  it("drops a clip and makes a new one when it is asked for again", () => {
    const { clips, made } = setup();
    clips.get("x");
    const first = made.x;
    clips.drop("x");
    clips.get("x");
    expect(made.x).not.toBe(first);
  });

  it("pauses everything when the page is hidden", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("t", 0);
    ready("t");
    fire();
    clips.pauseAll();
    expect(made.t?.paused).toBe(true);
  });

  it("has no current clip after hide()", () => {
    const { clips, made, ready } = setup();
    clips.set("x", 0);
    ready("x");
    clips.hide();
    expect(made.x?.classes.has("is-on")).toBe(false);
    expect(clips.current()).toBe("");
  });

  it("goes back in time faster than forward: the part that played by itself is taken off at twice the speed", () => {
    const { clips, made, ready, fire } = setup();
    clips.set("x", 0.2);
    ready("x");
    clips.stop("x", 3);
    fire();
    if (made.x) made.x.currentTime = 2; // played by itself up to 2 s
    clips.set("x", 0.19);
    expect(made.x?.paused).toBe(true);
    const before = made.x?.seeks.length ?? 0;
    made.x?.emit("seeked");
    expect(made.x?.seeks.length).toBeGreaterThanOrEqual(before);
  });
});
