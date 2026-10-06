// The logic of LogoIntro without React: when the 3D core is requested, when it plays, what is shown meanwhile.
// Everything that touches the browser comes in through `deps`, so the branches are tested without a browser.
//
// Rules (R-17, 06.10.2026):
//  - reduced motion or an intro already played in this session: only the still lockup, the 3D core is never requested;
//  - otherwise the core is requested by import() only after the browser is idle, and until it is ready the still
//    lockup stays on screen;
//  - the intro plays if the core is ready within `introWindowMs` of the mount; a later core means the visitor has
//    already looked at the still lockup, so the intro stays out (the hero goes straight to its loop);
//  - the session is marked at the end of the intro; the site has no sound.
import type { IntroSession } from "./intro-session.ts";

/** What the 3D core gives to this module; its type is taken from the entry without importing it at once. */
export type MotionModule = typeof import("../logo-motion/index.ts");

export type IntroPhase = "still" | "playing" | "done";

export interface IntroRun {
  /** `intro`: once, then the still lockup. `hero`: the intro and then a loop that goes on. */
  mode: "intro" | "hero";
  canvas: HTMLCanvasElement;
  caption?: HTMLElement | null | undefined;
  /** How long after the mount the intro may still start; later it is skipped. */
  introWindowMs: number;
  onPhase(phase: IntroPhase): void;
  onDone?(): void;
  /** The core failed to load or to start (offline, no WebGL): the still lockup stays. */
  onError?(error: unknown): void;
}

export interface IntroDeps {
  load(): Promise<MotionModule>;
  /** Calls `run` when the browser is idle; returns the cancel function. */
  whenIdle(run: () => void): () => void;
  now(): number;
  session: IntroSession;
  reducedMotion(): boolean;
}

/** `requestIdleCallback` (2 s at most), or a short timer where it does not exist (Safari). */
export function defaultWhenIdle(run: () => void): () => void {
  const host = globalThis as {
    requestIdleCallback?: (cb: () => void, options: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (host.requestIdleCallback) {
    const id = host.requestIdleCallback(run, { timeout: 2000 });
    return () => host.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(run, 200);
  return () => clearTimeout(timer);
}

/** Starts the logic for one mount; the returned `stop` is the cleanup of the effect. */
export function startIntro(run: IntroRun, deps: IntroDeps): { stop(): void } {
  if (deps.reducedMotion() || deps.session.hasPlayed()) return { stop() {} };
  const startedAt = deps.now();
  let stopped = false;
  let late = false;
  let motion: { dispose(): void } | null = null;

  const phase = (value: IntroPhase) => {
    if (!stopped) run.onPhase(value);
  };
  const release = () => {
    const current = motion;
    motion = null;
    current?.dispose();
  };

  async function begin() {
    if (stopped) return;
    let core: MotionModule;
    try {
      core = await deps.load();
    } catch (error) {
      run.onError?.(error);
      return;
    }
    if (stopped) return;
    let handle: ReturnType<MotionModule["createLogoMotion"]>;
    try {
      handle = core.createLogoMotion(run.canvas, {
        mode: run.mode,
        autoplay: false,
        caption: run.caption,
        onContextLost: () => {
          release();
          phase("still");
        },
        onDone: () => {
          if (stopped || late) return;
          deps.session.markPlayed();
          run.onDone?.();
          if (run.mode === "intro") {
            release();
            phase("done");
          }
        },
      });
      motion = handle;
      await handle.ready;
    } catch (error) {
      release();
      run.onError?.(error);
      return;
    }
    if (stopped) return release();
    late = deps.now() - startedAt > run.introWindowMs;
    if (late && run.mode === "intro") return release(); // the still lockup stays; the session is not used up
    phase("playing");
    handle.play(late ? core.INTRO_DURATION : 0);
  }

  const cancelIdle = deps.whenIdle(() => {
    void begin();
  });
  return {
    stop() {
      stopped = true;
      cancelIdle();
      release();
    },
  };
}
