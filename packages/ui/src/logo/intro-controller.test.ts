import { describe, expect, it, vi } from "vitest";
import {
  defaultWhenIdle,
  type IntroDeps,
  type IntroPhase,
  type IntroRun,
  type MotionModule,
  startIntro,
} from "./intro-controller.ts";
import { createIntroSession, type StorageLike } from "./intro-session.ts";

/** A controllable stand-in of the logo-motion core. */
function fakeMotion() {
  let resolveReady: () => void = () => {};
  let rejectReady: (e: unknown) => void = () => {};
  const ready = new Promise<void>((ok, fail) => {
    resolveReady = ok;
    rejectReady = fail;
  });
  ready.catch(() => {});
  const handle = { ready, play: vi.fn(), dispose: vi.fn() };
  const created: { options: Parameters<MotionModule["createLogoMotion"]>[1]; canvas: unknown }[] = [];
  const module = {
    INTRO_DURATION: 3.3,
    createLogoMotion: vi.fn((canvas: unknown, options: Parameters<MotionModule["createLogoMotion"]>[1]) => {
      created.push({ options, canvas });
      return handle;
    }),
  } as unknown as MotionModule;
  return { module, handle, created, resolveReady, rejectReady };
}

function setup(over: Partial<IntroDeps> = {}, run: Partial<IntroRun> = {}) {
  const motion = fakeMotion();
  const phases: IntroPhase[] = [];
  const idle: (() => void)[] = [];
  const cancelIdle = vi.fn();
  let clock = 0;
  const storage = new Map<string, string>();
  const store: StorageLike = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => void storage.set(k, v),
  };
  const session = createIntroSession(() => store);
  const load = vi.fn(async () => motion.module);
  const deps: IntroDeps = {
    load,
    whenIdle: (cb) => {
      idle.push(cb);
      return cancelIdle;
    },
    now: () => clock,
    session,
    reducedMotion: () => false,
    ...over,
  };
  const canvas = { id: "canvas" } as unknown as HTMLCanvasElement;
  const onDone = vi.fn();
  const onError = vi.fn();
  const runOptions: IntroRun = {
    mode: "intro",
    canvas,
    caption: null,
    introWindowMs: 1200,
    onPhase: (p) => phases.push(p),
    onDone,
    onError,
    ...run,
  };
  const handle = startIntro(runOptions, deps);
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return {
    motion,
    phases,
    idle,
    cancelIdle,
    load,
    session,
    canvas,
    onDone,
    onError,
    handle,
    flush,
    setClock: (t: number) => (clock = t),
    storage,
  };
}

describe("startIntro: when the 3D core is not even requested", () => {
  it("under reduced motion nothing is loaded, nothing is scheduled, nothing is stored (zero requests to three)", async () => {
    const s = setup({ reducedMotion: () => true });
    expect(s.idle).toHaveLength(0);
    expect(s.load).not.toHaveBeenCalled();
    expect(s.phases).toEqual([]);
    expect(s.storage.size).toBe(0);
    s.handle.stop();
    await s.flush();
    expect(s.load).not.toHaveBeenCalled();
  });

  it("when the intro has already played in this session: still lockup, no idle request, no load", () => {
    const played = createIntroSession(() => null);
    played.markPlayed();
    const s = setup({ session: played });
    expect(s.idle).toHaveLength(0);
    expect(s.load).not.toHaveBeenCalled();
    expect(s.phases).toEqual([]);
    s.handle.stop();
  });

  it("does not load before the browser is idle: the request waits for the idle callback", async () => {
    const s = setup();
    expect(s.idle).toHaveLength(1);
    expect(s.load).not.toHaveBeenCalled();
    s.idle[0]?.();
    await s.flush();
    expect(s.load).toHaveBeenCalledTimes(1);
  });
});

describe("startIntro: the intro on time", () => {
  it("creates the core on the canvas with autoplay off, waits for ready, then plays from 0", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    expect(s.motion.created).toHaveLength(1);
    expect(s.motion.created[0]?.canvas).toBe(s.canvas);
    expect(s.motion.created[0]?.options).toMatchObject({ mode: "intro", autoplay: false });
    expect(s.motion.handle.play).not.toHaveBeenCalled();
    expect(s.phases).toEqual([]); // the still lockup stays until the first frame is ready
    s.motion.resolveReady();
    await s.flush();
    expect(s.phases).toEqual(["playing"]);
    expect(s.motion.handle.play).toHaveBeenCalledWith(0);
  });

  it("at the end of the intro: marks the session, shows the still lockup again and frees the GPU", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    s.motion.resolveReady();
    await s.flush();
    expect(s.session.hasPlayed()).toBe(false);
    s.motion.created[0]?.options.onDone?.();
    expect(s.session.hasPlayed()).toBe(true);
    expect(s.phases).toEqual(["playing", "done"]);
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
    expect(s.onDone).toHaveBeenCalledTimes(1);
  });

  it("hero: marks the session at the end of the intro part and goes on looping (no dispose, no phase change)", async () => {
    const s = setup({}, { mode: "hero" });
    s.idle[0]?.();
    await s.flush();
    s.motion.resolveReady();
    await s.flush();
    s.motion.created[0]?.options.onDone?.();
    expect(s.motion.created[0]?.options.mode).toBe("hero");
    expect(s.session.hasPlayed()).toBe(true);
    expect(s.phases).toEqual(["playing"]);
    expect(s.motion.handle.dispose).not.toHaveBeenCalled();
  });

  it("passes the caption element to the core", async () => {
    const caption = { tag: "caption" } as unknown as HTMLElement;
    const s = setup({}, { caption });
    s.idle[0]?.();
    await s.flush();
    expect(s.motion.created[0]?.options.caption).toBe(caption);
  });
});

describe("startIntro: the core came late (the first visit without cache)", () => {
  it("intro: stays on the still lockup, frees the core and does not use up the session", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    s.setClock(2500);
    s.motion.resolveReady();
    await s.flush();
    expect(s.phases).toEqual([]);
    expect(s.motion.handle.play).not.toHaveBeenCalled();
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
    expect(s.session.hasPlayed()).toBe(false);
  });

  it("hero: goes straight to the loop (from the end of the intro), and does not count as the intro seen", async () => {
    const s = setup({}, { mode: "hero" });
    s.idle[0]?.();
    await s.flush();
    s.setClock(2500);
    s.motion.resolveReady();
    await s.flush();
    expect(s.phases).toEqual(["playing"]);
    expect(s.motion.handle.play).toHaveBeenCalledWith(3.3);
    s.motion.created[0]?.options.onDone?.();
    expect(s.session.hasPlayed()).toBe(false);
  });

  it("is on time at exactly the window", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    s.setClock(1200);
    s.motion.resolveReady();
    await s.flush();
    expect(s.motion.handle.play).toHaveBeenCalledWith(0);
  });
});

describe("startIntro: failures leave the still lockup", () => {
  it("a failed chunk (offline, 404) is reported and does not throw", async () => {
    const error = new Error("chunk failed");
    const s = setup({
      load: vi.fn(async () => {
        throw error;
      }),
    });
    s.idle[0]?.();
    await s.flush();
    expect(s.onError).toHaveBeenCalledWith(error);
    expect(s.phases).toEqual([]);
  });

  it("no WebGL (ready rejects): the core is freed, the still lockup stays, the session is not used up", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    const error = new Error("WebGL is not available");
    s.motion.rejectReady(error);
    await s.flush();
    expect(s.onError).toHaveBeenCalledWith(error);
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
    expect(s.phases).toEqual([]);
    expect(s.session.hasPlayed()).toBe(false);
  });

  it("a throw while creating the core is handled the same way", async () => {
    const motion = fakeMotion();
    (motion.module.createLogoMotion as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("no context");
    });
    const s = setup({ load: async () => motion.module });
    s.idle[0]?.();
    await s.flush();
    expect(s.onError).toHaveBeenCalledTimes(1);
    expect(s.phases).toEqual([]);
  });

  it("a lost GPU context during the intro returns to the still lockup", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    s.motion.resolveReady();
    await s.flush();
    s.motion.created[0]?.options.onContextLost?.();
    expect(s.phases).toEqual(["playing", "still"]);
    expect(s.motion.handle.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("startIntro: stop (unmount)", () => {
  it("before idle: cancels the idle request and never loads", async () => {
    const s = setup();
    s.handle.stop();
    expect(s.cancelIdle).toHaveBeenCalledTimes(1);
    s.idle[0]?.();
    await s.flush();
    expect(s.load).not.toHaveBeenCalled();
  });

  it("while the core is loading: frees it when it arrives and reports no phase", async () => {
    const s = setup();
    s.idle[0]?.();
    s.handle.stop();
    await s.flush();
    expect(s.motion.created).toHaveLength(0);
    expect(s.phases).toEqual([]);
  });

  it("while the core builds the scene: disposes it and never plays", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    s.handle.stop();
    s.motion.resolveReady();
    await s.flush();
    expect(s.motion.handle.dispose).toHaveBeenCalled();
    expect(s.motion.handle.play).not.toHaveBeenCalled();
    expect(s.phases).toEqual([]);
  });

  it("while playing: disposes the core and ignores late callbacks (done, context lost)", async () => {
    const s = setup();
    s.idle[0]?.();
    await s.flush();
    s.motion.resolveReady();
    await s.flush();
    s.handle.stop();
    s.motion.created[0]?.options.onDone?.();
    s.motion.created[0]?.options.onContextLost?.();
    expect(s.motion.handle.dispose).toHaveBeenCalled();
    expect(s.phases).toEqual(["playing"]);
    expect(s.session.hasPlayed()).toBe(false);
  });

  it("is safe to call twice (React StrictMode runs the effect, its cleanup and the effect again)", async () => {
    const s = setup();
    s.handle.stop();
    s.handle.stop();
    expect(s.cancelIdle).toHaveBeenCalledTimes(2);
    const again = setup();
    again.idle[0]?.();
    await again.flush();
    again.motion.resolveReady();
    await again.flush();
    expect(again.phases).toEqual(["playing"]);
  });
});

describe("startIntro with a storage that throws", () => {
  it("plays, and at the end remembers in memory without an exception", async () => {
    const blocked: IntroDeps["session"] = createIntroSession(() => {
      throw new Error("SecurityError");
    });
    const s = setup({ session: blocked });
    s.idle[0]?.();
    await s.flush();
    s.motion.resolveReady();
    await s.flush();
    expect(() => s.motion.created[0]?.options.onDone?.()).not.toThrow();
    expect(blocked.hasPlayed()).toBe(true);
    expect(s.phases).toEqual(["playing", "done"]);
  });
});

describe("defaultWhenIdle", () => {
  it("uses requestIdleCallback with a timeout when it exists, and cancels with cancelIdleCallback", () => {
    const host = globalThis as Record<string, unknown>;
    const ric = vi.fn((_cb: () => void, _o: { timeout: number }) => 7);
    const cic = vi.fn();
    host.requestIdleCallback = ric;
    host.cancelIdleCallback = cic;
    try {
      const cancel = defaultWhenIdle(() => {});
      expect(ric).toHaveBeenCalledTimes(1);
      expect(ric.mock.calls[0]?.[1]).toEqual({ timeout: 2000 });
      cancel();
      expect(cic).toHaveBeenCalledWith(7);
    } finally {
      Reflect.deleteProperty(host, "requestIdleCallback");
      Reflect.deleteProperty(host, "cancelIdleCallback");
    }
  });

  it("falls back to a timer (Safari has no requestIdleCallback)", () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const cancel = defaultWhenIdle(run);
      expect(run).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(run).toHaveBeenCalledTimes(1);
      const run2 = vi.fn();
      defaultWhenIdle(run2)();
      vi.advanceTimersByTime(1000);
      expect(run2).not.toHaveBeenCalled();
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
