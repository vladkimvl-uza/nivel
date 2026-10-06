// The logic of LogoIntro without React: when the 3D core is requested, when it plays, what is shown meanwhile.
// Everything that touches the browser comes in through `deps`, so the branches are tested without a browser.
//
// Rules (R-17, 06.10.2026):
//  - reduced motion or an intro already played in this session: only the still lockup, the 3D core is never requested;
//  - otherwise the core is requested by import() only after the browser is idle, and until it is ready the still
//    lockup stays on screen;
//  - the intro plays if the core is ready within `introWindowMs` of the mount; a later core means the visitor has
//    already looked at the still lockup, so the intro stays out (the hero goes straight to its loop);
//  - the session is marked at the end of the intro; the site has no sound;
//  - a data saver or a slow link (`constrained`) is treated like reduced motion: the core is never requested;
//  - while the core plays, a box outside the viewport or a hidden tab pauses it (the loop of the hero would otherwise
//    draw for ever), and "reduce" switched on during the play releases the core and shows the still lockup.
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
  /** A data saver, a 2g/3g link or a weak device: only the still lockup. Missing: not constrained. */
  constrained?(): boolean;
  /** Tells whether the canvas is on screen (and the tab shown); the first call is the state at the start. */
  watchVisible?(target: Element, onChange: (visible: boolean) => void): () => void;
  /** Tells the new value when the reduced-motion preference changes. */
  watchReducedMotion?(onChange: (reduced: boolean) => void): () => void;
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
  if (deps.reducedMotion() || deps.constrained?.() === true || deps.session.hasPlayed()) return { stop() {} };
  const startedAt = deps.now();
  let stopped = false;
  let late = false;
  let motion: { dispose(): void; pause(): void; resume(): void } | null = null;
  let unwatch: (() => void)[] = [];

  const phase = (value: IntroPhase) => {
    if (!stopped) run.onPhase(value);
  };
  const release = () => {
    const watchers = unwatch;
    unwatch = [];
    for (const stopWatching of watchers) stopWatching();
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
          if (stopped || late || motion === null) return; // released (reduced motion, lost context): not an intro seen
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
    watchWhilePlaying();
  }

  /** The motion stops when nobody sees it, and is released when the visitor asks for less motion. */
  function watchWhilePlaying() {
    const visible = deps.watchVisible?.(run.canvas, (isVisible) => {
      if (isVisible) motion?.resume();
      else motion?.pause();
    });
    if (visible) unwatch.push(visible);
    const reduced = deps.watchReducedMotion?.((isReduced) => {
      if (!isReduced) return;
      release();
      phase("still");
    });
    if (reduced) unwatch.push(reduced);
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
