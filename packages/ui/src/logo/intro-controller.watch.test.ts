import { describe, expect, it, vi } from "vitest";
import { type IntroDeps, type IntroPhase, type IntroRun, type MotionModule, startIntro } from "./intro-controller.ts";
import { createIntroSession } from "./intro-session.ts";

/** A controllable stand-in of the logo-motion core (the part of it that the controller touches). */
function fakeMotion() {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((ok) => {
    resolveReady = ok;
  });
  const handle = { ready, play: vi.fn(), pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() };
  const created: { onDone?: () => void }[] = [];
  const module = {
    INTRO_DURATION: 3.3,
    createLogoMotion: vi.fn((_: unknown, options: { onDone?: () => void }) => {
      created.push(options);
      return handle;
    }),
  } as unknown as MotionModule;
  return { module, handle, created, resolveReady };
}

/** The two watchers of the browser, handed to the test so that it fires them. */
function watchers() {
  const visible: ((v: boolean) => void)[] = [];
  const reduced: ((v: boolean) => void)[] = [];
  const unVisible = vi.fn();
  const unReduced = vi.fn();
  const watchVisible = vi.fn((_: Element, cb: (v: boolean) => void) => {
    visible.push(cb);
    return unVisible;
  });
  const watchReducedMotion = vi.fn((cb: (v: boolean) => void) => {
    reduced.push(cb);
    return unReduced;
  });
  return { visible, reduced, unVisible, unReduced, watchVisible, watchReducedMotion };
}

function setup(over: Partial<IntroDeps> = {}, run: Partial<IntroRun> = {}) {
  const motion = fakeMotion();
  const phases: IntroPhase[] = [];
  const idle: (() => void)[] = [];
  const session = createIntroSession(() => null);
  const load = vi.fn(async () => motion.module);
  const canvas = { id: "canvas" } as unknown as HTMLCanvasElement;
  const deps: IntroDeps = {
    load,
    whenIdle: (cb) => {
      idle.push(cb);
      return () => {};
    },
    now: () => 0,
    session,
    reducedMotion: () => false,
    ...over,
  };
  const handle = startIntro(
    { mode: "intro", canvas, introWindowMs: 1200, onPhase: (p) => phases.push(p), ...run },
    deps,
  );
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return { motion, phases, idle, session, canvas, load, handle, flush };
}

async function playing(over: Partial<IntroDeps>, run: Partial<IntroRun>) {
  const s = setup(over, run);
  s.idle[0]?.();
  await s.flush();
  s.motion.resolveReady();
  await s.flush();
  return s;
}

describe("startIntro: the loop stops when nobody looks at it", () => {
  it("watches the canvas only once the core plays (not while it loads); pauses off screen, resumes on return", async () => {
    const w = watchers();
    const s = setup(w, { mode: "hero" });
    s.idle[0]?.();
    await s.flush();
    expect(w.watchVisible).not.toHaveBeenCalled();
    s.motion.resolveReady();
    await s.flush();
    expect(w.watchVisible).toHaveBeenCalledWith(s.canvas, expect.any(Function));
    w.visible[0]?.(false);
    expect(s.motion.handle.pause).toHaveBeenCalledTimes(1);
    w.visible[0]?.(true);
    expect(s.motion.handle.resume).toHaveBeenCalledTimes(1);
    expect(s.motion.handle.dispose).not.toHaveBeenCalled();
  });

  it("a box that is off screen from the first frame is paused at once (the observer tells its state first)", async () => {
    const w = watchers();
    w.watchVisible.mockImplementation((_: Element, cb: (v: boolean) => void) => {
      cb(false);
      return w.unVisible;
    });
    const s = await playing(w, { mode: "hero" });
    expect(s.motion.handle.play).toHaveBeenCalledTimes(1);
    expect(s.motion.handle.pause).toHaveBeenCalledTimes(1);
  });

  it("stops watching at the end of an intro (the core is released) and on unmount", async () => {
    const w = watchers();
    const s = await playing(w, { mode: "intro" });
    s.motion.created[0]?.onDone?.();
    expect(w.unVisible).toHaveBeenCalledTimes(1);
    expect(w.unReduced).toHaveBeenCalledTimes(1);
    const w2 = watchers();
    const s2 = await playing(w2, { mode: "hero" });
    s2.handle.stop();
    expect(w2.unVisible).toHaveBeenCalledTimes(1);
    expect(w2.unReduced).toHaveBeenCalledTimes(1);
    expect(s2.motion.handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("reduced motion switched on during the loop: frees the core, shows the still lockup, leaves the session alone", async () => {
    const w = watchers();
    const s = await playing(w, { mode: "hero" });
    w.reduced[0]?.(true);
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
    expect(s.phases).toEqual(["playing", "still"]);
    expect(w.unVisible).toHaveBeenCalledTimes(1);
    expect(s.session.hasPlayed()).toBe(false);
    w.visible[0]?.(true); // a late callback does nothing to a freed core
    expect(s.motion.handle.resume).not.toHaveBeenCalled();
  });

  it("switching reduced motion off again does nothing", async () => {
    const w = watchers();
    const s = await playing(w, { mode: "hero" });
    w.reduced[0]?.(false);
    expect(s.motion.handle.dispose).not.toHaveBeenCalled();
    expect(s.phases).toEqual(["playing"]);
  });

  it("reduced motion during an intro stops it the same way, and its end is not counted", async () => {
    const w = watchers();
    const s = await playing(w, { mode: "intro" });
    w.reduced[0]?.(true);
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
    expect(s.phases).toEqual(["playing", "still"]);
    s.motion.created[0]?.onDone?.();
    expect(s.session.hasPlayed()).toBe(false);
  });

  it("works without the watchers (they are optional deps)", async () => {
    const s = await playing({}, { mode: "hero" });
    expect(s.phases).toEqual(["playing"]);
    s.handle.stop();
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("startIntro: a data saver or a slow link keeps the still lockup", () => {
  it("does not schedule idle time and does not load (the same as reduced motion)", () => {
    const s = setup({ constrained: () => true });
    expect(s.idle).toHaveLength(0);
    expect(s.load).not.toHaveBeenCalled();
    expect(s.phases).toEqual([]);
    s.handle.stop();
  });

  it("a normal link goes on as before", () => {
    const s = setup({ constrained: () => false });
    expect(s.idle).toHaveLength(1);
    s.handle.stop();
  });
});
