import type { Texture, WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCaption, browserDeps, createLogoMotion, type MotionDeps } from "./create.ts";
import { INTRO_DURATION } from "./timeline.ts";

/** Browser parts replaced by hand: a fake renderer, a frame queue that the test turns, a canvas with a size. */
function harness(over: Partial<MotionDeps> = {}) {
  const renderer = {
    shadowMap: { enabled: false, type: -1 },
    toneMapping: -1,
    outputColorSpace: "",
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    compileAsync: vi.fn(async () => {}),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  const environment = { dispose: vi.fn() };
  const queue = new Map<number, (now: number) => void>();
  let nextId = 1;
  const cancelFrame = vi.fn((id: number) => void queue.delete(id));
  const listeners = new Map<string, (e: Event) => void>();
  const canvas = {
    clientWidth: 1080,
    clientHeight: 1080,
    width: 1080,
    height: 1080,
    addEventListener: vi.fn((type: string, fn: (e: Event) => void) => void listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => void listeners.delete(type)),
  } as unknown as HTMLCanvasElement;
  const deps: MotionDeps = {
    createRenderer: vi.fn(() => renderer as unknown as WebGLRenderer),
    createEnvironment: vi.fn(() => environment as unknown as Texture),
    isLite: () => false,
    devicePixelRatio: () => 3,
    requestFrame: (cb) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelFrame,
    ...over,
  };
  /** Runs the frame callbacks that are queued now (the ones they queue wait for the next call). */
  const frame = (now: number) => {
    const due = [...queue.entries()];
    queue.clear();
    for (const [, cb] of due) cb(now);
  };
  /** Frames of a real display: one every 16 ms from `from` to `to` ms (a bigger gap counts as a stall). */
  const run = (from: number, to: number) => {
    for (let now = from; now < to; now += 16) frame(now);
    frame(to);
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  /** Waits for `ready`, running the one frame that `ready` itself waits for. */
  const settle = async (m: { ready: Promise<void> }) => {
    await flush();
    frame(0);
    await m.ready;
    await flush();
  };
  return { renderer, environment, queue, cancelFrame, canvas, deps, frame, run, flush, settle, listeners };
}

const captionEl = () =>
  ({ style: {} as Record<string, string> }) as unknown as HTMLElement & { style: Record<string, string> };

afterEach(() => vi.restoreAllMocks());

describe("createLogoMotion: start", () => {
  it("builds the renderer and the room environment at once, and draws nothing before the programs are compiled", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    expect(h.deps.createRenderer).toHaveBeenCalledWith(h.canvas, false);
    expect(h.deps.createEnvironment).toHaveBeenCalledTimes(1);
    expect(h.renderer.compileAsync).toHaveBeenCalledTimes(1);
    expect(h.renderer.render).not.toHaveBeenCalled();
    await h.settle(m);
  });

  it("cold start: compile, one warm-up frame off screen, one frame of waiting, then the clock starts at t = 0", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro", caption: null }, h.deps);
    await h.flush();
    expect(h.renderer.render).toHaveBeenCalledTimes(1); // the warm-up frame, drawn before it is ever shown
    h.frame(0); // the waiting frame
    await m.ready;
    expect(m.time()).toBe(0);
    h.frame(5000); // the first frame of the clock: t = 0 whatever the wall clock says
    expect(m.time()).toBe(0);
    h.run(5016, 5500);
    expect(m.time()).toBeCloseTo(0.5, 6);
  });

  it("sets the size from the canvas and caps the pixel ratio at 2 (1.5 on phones)", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "static" }, h.deps);
    await h.settle(m);
    expect(h.renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(h.renderer.setSize).toHaveBeenCalledWith(1080, 1080, false);
    const lite = harness({ isLite: () => true });
    const m2 = createLogoMotion(lite.canvas, { mode: "static" }, lite.deps);
    await lite.settle(m2);
    expect(lite.renderer.setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(lite.deps.createRenderer).toHaveBeenCalledWith(lite.canvas, true);
  });

  it("rejects `ready` when WebGL is not available, and releases what it had built", async () => {
    const h = harness({
      createRenderer: () => {
        throw new Error("Error creating WebGL context.");
      },
    });
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    await expect(m.ready).rejects.toThrow(/WebGL/);
    expect(() => m.dispose()).not.toThrow();
  });
});

describe("createLogoMotion: intro", () => {
  it("plays 3.3 s and holds the last frame: the clock stops, no more frames are asked for, onDone fires once", async () => {
    const h = harness();
    const onDone = vi.fn();
    const m = createLogoMotion(h.canvas, { mode: "intro", onDone }, h.deps);
    await h.settle(m);
    h.run(1000, 3000);
    expect(onDone).not.toHaveBeenCalled();
    h.run(3016, 4400);
    expect(m.time()).toBe(INTRO_DURATION);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.queue.size).toBe(0);
    const calls = h.renderer.render.mock.calls.length;
    h.frame(9999);
    expect(h.renderer.render.mock.calls.length).toBe(calls);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not skip time after a stall: a frame that took more than 100 ms moves the clock by one frame", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    await h.settle(m);
    h.frame(1000);
    h.frame(1016);
    expect(m.time()).toBeCloseTo(0.016, 6);
    h.frame(2016); // the tab was stalled for a second
    expect(m.time()).toBeCloseTo(0.016 + 1 / 60, 3);
  });

  it("moves the caption over the shelf while the shelf seats", async () => {
    const h = harness();
    const caption = captionEl();
    const m = createLogoMotion(h.canvas, { mode: "intro", caption }, h.deps);
    await h.settle(m);
    h.run(0, 1400);
    expect(Number(caption.style.opacity)).toBeGreaterThan(0.5);
    expect(caption.style.transform).toMatch(/^translate\(.+px, .+px\) translate\(-100%, -100%\)$/);
    expect(Number.parseFloat(caption.style.fontSize ?? "")).toBeGreaterThan(3);
    h.run(1416, 2500);
    expect(caption.style.opacity).toBe("0");
  });
});

describe("createLogoMotion: hero, static, manual", () => {
  it("hero: onDone fires at the end of the intro part and the loop goes on", async () => {
    const h = harness();
    const onDone = vi.fn();
    const m = createLogoMotion(h.canvas, { mode: "hero", onDone }, h.deps);
    await h.settle(m);
    h.run(0, 4000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(m.time()).toBeGreaterThan(INTRO_DURATION);
    expect(h.queue.size).toBe(1);
    m.dispose();
  });

  it("static: draws the final frame once, tells onDone and never starts the clock", async () => {
    const h = harness();
    const onDone = vi.fn();
    const m = createLogoMotion(h.canvas, { mode: "static", onDone }, h.deps);
    await h.settle(m);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.queue.size).toBe(0);
    m.play(1);
    expect(h.queue.size).toBe(0);
    expect(h.renderer.render).toHaveBeenCalledTimes(1);
  });

  it("autoplay off: waits for play(at) and starts there (the intro that came late goes straight to the loop)", async () => {
    const h = harness();
    const onDone = vi.fn();
    const m = createLogoMotion(h.canvas, { mode: "hero", autoplay: false, onDone }, h.deps);
    await h.settle(m);
    expect(h.queue.size).toBe(0);
    m.play(INTRO_DURATION);
    expect(h.queue.size).toBe(1);
    h.frame(100);
    expect(m.time()).toBe(INTRO_DURATION);
    expect(onDone).toHaveBeenCalledTimes(1);
    m.play(0);
    h.frame(200);
    expect(m.time()).toBe(0);
  });

  it("startAt moves the first frame of the clock", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro", startAt: 2 }, h.deps);
    await h.settle(m);
    h.frame(100);
    expect(m.time()).toBe(2);
    h.run(116, 600);
    expect(m.time()).toBeCloseTo(2.5, 6);
  });

  it("seek draws a frame at once, stops the clock and returns what the DOM shows (the clips)", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro", autoplay: false }, h.deps);
    await h.settle(m);
    const before = h.renderer.render.mock.calls.length;
    const info = m.seek(1.4);
    expect(h.renderer.render.mock.calls.length).toBe(before + 1);
    expect(info.caption.alpha).toBeGreaterThan(0);
    expect(m.time()).toBe(1.4);
    expect(m.seek(-5).caption.alpha).toBe(0);
    expect(m.time()).toBe(0);
    expect(m.duration).toBe(INTRO_DURATION);
    expect(m.clicks).toHaveLength(5);
  });

  it("seek before the scene exists returns an empty caption instead of throwing", async () => {
    const h = harness({
      createRenderer: () => {
        throw new Error("no WebGL");
      },
    });
    const m = createLogoMotion(h.canvas, { mode: "intro", autoplay: false }, h.deps);
    m.ready.catch(() => {});
    expect(m.seek(1).caption).toEqual({ alpha: 0, x: 0, y: 0, fontPx: 0 });
  });
});

describe("createLogoMotion: release", () => {
  it("dispose stops the loop, frees the scene, the environment and the GPU context, and may be called twice", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    await h.settle(m);
    h.frame(1000);
    expect(h.queue.size).toBe(1);
    m.dispose();
    expect(h.queue.size).toBe(0);
    expect(h.environment.dispose).toHaveBeenCalledTimes(1);
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(h.renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    m.dispose();
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(h.canvas.removeEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
  });

  it("dispose before ready: the clock never starts and the GPU is still released", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    m.dispose();
    await h.flush();
    h.frame(0);
    await m.ready;
    expect(h.queue.size).toBe(0);
    expect(h.renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it("dispose during the waiting frame is the same", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    await h.flush();
    m.dispose();
    h.frame(0);
    await m.ready;
    expect(h.queue.size).toBe(0);
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("a lost GPU context stops the loop and tells the caller (it shows the still lockup)", async () => {
    const h = harness();
    const onContextLost = vi.fn();
    const m = createLogoMotion(h.canvas, { mode: "intro", onContextLost }, h.deps);
    await h.settle(m);
    h.frame(1000);
    const event = { preventDefault: vi.fn() } as unknown as Event;
    h.listeners.get("webglcontextlost")?.(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(h.queue.size).toBe(0);
    m.dispose();
  });

  it("resize reads the canvas again and does nothing before the scene exists", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro", autoplay: false }, h.deps);
    await h.settle(m);
    (h.canvas as unknown as { clientWidth: number }).clientWidth = 390;
    (h.canvas as unknown as { clientHeight: number }).clientHeight = 844;
    m.resize();
    expect(h.renderer.setSize).toHaveBeenLastCalledWith(390, 844, false);
    m.dispose();
    const calls = h.renderer.setSize.mock.calls.length;
    m.resize();
    expect(h.renderer.setSize.mock.calls.length).toBe(calls);
  });

  it("uses the pixel size of the canvas when it has no CSS size yet (hidden box)", async () => {
    const h = harness();
    (h.canvas as unknown as { clientWidth: number }).clientWidth = 0;
    (h.canvas as unknown as { clientHeight: number }).clientHeight = 0;
    const m = createLogoMotion(h.canvas, { mode: "static" }, h.deps);
    await h.settle(m);
    expect(h.renderer.setSize).toHaveBeenCalledWith(1080, 1080, false);
  });
});

describe("applyCaption", () => {
  it("does nothing without an element", () => {
    expect(() => applyCaption(null, { alpha: 1, x: 1, y: 1, fontPx: 10 })).not.toThrow();
    expect(() => applyCaption(undefined, { alpha: 0, x: 0, y: 0, fontPx: 0 })).not.toThrow();
  });

  it("hides the caption at alpha 0 without touching its place", () => {
    const el = captionEl();
    applyCaption(el, { alpha: 0, x: 5, y: 5, fontPx: 9 });
    expect(el.style).toEqual({ opacity: "0" });
  });

  it("sets the opacity, the size and the position: the right end of the baseline is at (x, y)", () => {
    const el = captionEl();
    applyCaption(el, { alpha: 0.9, x: 400.5, y: 300, fontPx: 16.5551 });
    expect(el.style).toEqual({
      fontSize: "16.56px",
      transform: "translate(400.5px, 300px) translate(-100%, -100%)",
      opacity: "0.900",
    });
  });
});

describe("browserDeps (the defaults of the browser)", () => {
  it("knows a phone from a narrow window, and is not lite in Node (no matchMedia, no window)", () => {
    expect(browserDeps.isLite()).toBe(false);
    const host = globalThis as Record<string, unknown>;
    host.matchMedia = () => ({ matches: true });
    try {
      expect(browserDeps.isLite()).toBe(true);
    } finally {
      Reflect.deleteProperty(host, "matchMedia");
    }
    host.innerWidth = 390;
    try {
      expect(browserDeps.isLite()).toBe(true);
    } finally {
      Reflect.deleteProperty(host, "innerWidth");
    }
  });

  it("takes the device pixel ratio, 1 when there is none, and asks the window for frames", () => {
    expect(browserDeps.devicePixelRatio()).toBe(1);
    const host = globalThis as Record<string, unknown>;
    const raf = vi.fn(() => 42);
    const caf = vi.fn();
    host.devicePixelRatio = 2.5;
    host.requestAnimationFrame = raf;
    host.cancelAnimationFrame = caf;
    try {
      expect(browserDeps.devicePixelRatio()).toBe(2.5);
      expect(browserDeps.requestFrame(() => {})).toBe(42);
      browserDeps.cancelFrame(42);
      expect(caf).toHaveBeenCalledWith(42);
    } finally {
      for (const k of ["devicePixelRatio", "requestAnimationFrame", "cancelAnimationFrame"])
        Reflect.deleteProperty(host, k);
    }
  });
});

describe("createLogoMotion: the resize observer waits for the warm-up", () => {
  /** A ResizeObserver that the test fires by hand; it records when it was created. */
  function stubObserver() {
    const made: { fire(): void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    class FakeResizeObserver {
      private cb: () => void;
      disconnect = vi.fn();
      constructor(cb: () => void) {
        this.cb = cb;
        made.push({ fire: () => this.cb(), disconnect: this.disconnect });
      }
      observe() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return made;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("is not connected while the programs compile: no frame is drawn before they are ready", async () => {
    const made = stubObserver();
    let finishCompile: () => void = () => {};
    const h = harness();
    h.renderer.compileAsync.mockImplementation(() => new Promise<void>((ok) => (finishCompile = ok)));
    const m = createLogoMotion(h.canvas, { mode: "intro" }, h.deps);
    await h.flush();
    expect(made).toHaveLength(0);
    expect(h.renderer.render).not.toHaveBeenCalled();
    finishCompile();
    await h.flush();
    expect(h.renderer.render).toHaveBeenCalledTimes(1); // the warm-up frame
    h.frame(0);
    await m.ready;
    expect(made).toHaveLength(1);
    m.dispose();
    expect(made[0]?.disconnect).toHaveBeenCalled();
  });

  it("once connected, a change of size sets the size again and redraws a clock that is not running", async () => {
    const made = stubObserver();
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "static" }, h.deps);
    await h.settle(m);
    const sizes = h.renderer.setSize.mock.calls.length;
    const draws = h.renderer.render.mock.calls.length;
    made[0]?.fire();
    expect(h.renderer.setSize.mock.calls.length).toBe(sizes + 1);
    expect(h.renderer.render.mock.calls.length).toBe(draws + 1);
    m.dispose();
  });
});

describe("createLogoMotion: pause and resume (a loop that nobody sees stops)", () => {
  it("pause stops the frames and keeps the time; resume goes on from the same time, without a jump", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "hero" }, h.deps);
    await h.settle(m);
    h.run(0, 5000);
    const at = m.time();
    expect(at).toBeGreaterThan(INTRO_DURATION);
    m.pause();
    expect(h.queue.size).toBe(0);
    const draws = h.renderer.render.mock.calls.length;
    h.frame(9000);
    expect(h.renderer.render.mock.calls.length).toBe(draws);
    expect(m.time()).toBe(at);
    m.resume();
    h.frame(60_000); // the first frame after the pause is the paused time, whatever the wall clock says
    expect(m.time()).toBeCloseTo(at, 6);
    h.run(60_016, 60_500);
    expect(m.time()).toBeCloseTo(at + 0.5, 3);
    m.dispose();
  });

  it("pause twice and resume twice are harmless; resume without a pause starts nothing new", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "hero" }, h.deps);
    await h.settle(m);
    h.run(0, 400);
    m.resume();
    expect(h.queue.size).toBe(1); // still the one loop, not two
    m.pause();
    m.pause();
    expect(h.queue.size).toBe(0);
    m.resume();
    m.resume();
    expect(h.queue.size).toBe(1);
    m.dispose();
  });

  it("a clock that was not running (autoplay off, finished intro) is not started by resume", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "intro", autoplay: false }, h.deps);
    await h.settle(m);
    m.pause();
    m.resume();
    expect(h.queue.size).toBe(0);
    m.dispose();
    const done = harness();
    const m2 = createLogoMotion(done.canvas, { mode: "intro" }, done.deps);
    await done.settle(m2);
    done.run(0, 4400);
    m2.pause();
    m2.resume();
    expect(done.queue.size).toBe(0);
  });

  it("an explicit play() after a pause plays; dispose clears a pause", async () => {
    const h = harness();
    const m = createLogoMotion(h.canvas, { mode: "hero", autoplay: false }, h.deps);
    await h.settle(m);
    m.play(0);
    h.run(0, 200);
    m.pause();
    m.play(1);
    expect(h.queue.size).toBe(1);
    m.pause();
    m.dispose();
    m.resume();
    expect(h.queue.size).toBe(0);
  });
});
