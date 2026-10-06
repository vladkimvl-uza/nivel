// createLogoMotion(canvas, { mode, onDone }): plays the intro "Fit to tolerance" on a canvas and returns a handle.
// Plain TypeScript, no React. The core is loaded by a dynamic import() only (LogoIntro does that after idle time);
// it needs three, which is why it is a separate entry of the package (`@nivel/ui/logo-motion`).
import { PMREMGenerator, type Texture, WebGLRenderer } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createLogoScene, type FrameInfo, type LogoScene } from "./scene.ts";
import { CLICKS, frameAt, INTRO_DURATION, type MotionMode } from "./timeline.ts";

export interface LogoMotionOptions {
  /** `intro` plays once and holds the last frame; `hero` is the intro and then a seamless loop; `static` draws the final frame. */
  mode: Extract<MotionMode, "intro" | "hero" | "static">;
  /** The intro has played to its end (hero: its intro part), or the static frame is drawn. Called once. */
  onDone?: (() => void) | undefined;
  /** The GPU reset the context: the loop is stopped and the caller should show the still lockup. */
  onContextLost?: (() => void) | undefined;
  /** Element for the caption over the shelf; the core sets its opacity, size and position. */
  caption?: HTMLElement | null | undefined;
  /** `false`: draw nothing by itself (the clips seek frame by frame). Default `true`. */
  autoplay?: boolean | undefined;
  /** Start time in seconds (hero after a late load starts in the loop: `INTRO_DURATION`). */
  startAt?: number | undefined;
}

export interface LogoMotion {
  /** Resolves when the programs are compiled and the first frame is drawn; rejects when WebGL is not available. */
  readonly ready: Promise<void>;
  /**
   * Starts the clock at `at` seconds (default 0) when `autoplay` is off: the caller decides after `ready` whether the
   * intro is still on time. The first frame drawn is at `at`.
   */
  play(at?: number): void;
  /**
   * Stops the frames and keeps the time, while nobody sees the canvas (outside the viewport, a hidden tab). Does
   * nothing when the clock is not running.
   */
  pause(): void;
  /** Goes on from the paused time, without a jump; does nothing when the clock was not paused by `pause()`. */
  resume(): void;
  /** Draws the frame at time `t` at once and stops the clock (clips, tests); the caption follows. */
  seek(t: number): FrameInfo;
  /** The clock of the animation, seconds (0 before the first frame; it stops where the intro ends). */
  time(): number;
  /** Re-reads the size of the canvas (called by the ResizeObserver; call it when the box changes without one). */
  resize(): void;
  /** Stops the loop and releases the GPU memory and the context. Safe to call more than once and before `ready`. */
  dispose(): void;
  readonly duration: number;
  /** Times of the five seats, s: the sound of a clip is cut on them. */
  readonly clicks: typeof CLICKS;
}

/** Everything that touches the browser, replaceable in tests. */
export interface MotionDeps {
  createRenderer(canvas: HTMLCanvasElement, lite: boolean): WebGLRenderer;
  createEnvironment(renderer: WebGLRenderer): Texture | null;
  /** Phones and narrow frames: smaller shadow maps and a lower pixel ratio. */
  isLite(): boolean;
  devicePixelRatio(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
}

/** Shows or hides the caption element of the frame (opacity, size and position). */
export function applyCaption(el: HTMLElement | null | undefined, caption: FrameInfo["caption"]): void {
  if (!el) return;
  if (caption.alpha <= 0) {
    el.style.opacity = "0";
    return;
  }
  el.style.fontSize = `${caption.fontPx.toFixed(2)}px`;
  el.style.transform = `translate(${caption.x}px, ${caption.y}px) translate(-100%, -100%)`;
  el.style.opacity = caption.alpha.toFixed(3);
}

export const browserDeps: MotionDeps = {
  createRenderer: (canvas) => new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }),
  createEnvironment(renderer) {
    const pmrem = new PMREMGenerator(renderer);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  },
  isLite: () => globalThis.matchMedia?.("(pointer:coarse)").matches === true || globalThis.innerWidth < 860,
  devicePixelRatio: () => globalThis.devicePixelRatio || 1,
  requestFrame: (cb) => globalThis.requestAnimationFrame(cb),
  cancelFrame: (id) => globalThis.cancelAnimationFrame(id),
};

/** A frame that took longer than this shifts the clock instead of skipping time (a stalled tab, a slow shader build). */
const STALL_MS = 100;

export function createLogoMotion(
  canvas: HTMLCanvasElement,
  options: LogoMotionOptions,
  deps: MotionDeps = browserDeps,
): LogoMotion {
  const { mode } = options;
  const autoplay = options.autoplay !== false && mode !== "static";
  let renderer: WebGLRenderer | null = null;
  let environment: Texture | null = null;
  let scene: LogoScene | null = null;
  let observer: ResizeObserver | null = null;
  let disposed = false;
  let playing = false;
  let paused = false;
  let raf = 0;
  let t0: number | null = null;
  let last = 0;
  let tNow = Math.max(0, options.startAt ?? 0);
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    options.onDone?.();
  };

  function resize() {
    if (!renderer || !scene) return;
    const w = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const h = Math.max(1, canvas.clientHeight || canvas.height || 1);
    renderer.setPixelRatio(Math.min(deps.devicePixelRatio(), deps.isLite() ? 1.5 : 2));
    renderer.setSize(w, h, false);
    scene.setSize(w, h);
  }

  function draw(t: number): FrameInfo | null {
    if (!scene) return null;
    const info = scene.draw(frameAt(mode, t));
    applyCaption(options.caption, info.caption);
    return info;
  }

  function tick(now: number) {
    raf = 0;
    if (disposed || !scene) return;
    if (playing) {
      if (t0 === null) t0 = now - tNow * 1000;
      else if (now - last > STALL_MS) t0 += now - last - 1000 / 60;
      last = now;
      tNow = (now - t0) / 1000;
      if (mode === "intro" && tNow >= INTRO_DURATION) {
        tNow = INTRO_DURATION;
        playing = false;
      }
    }
    draw(tNow);
    if (tNow >= INTRO_DURATION) finish();
    if (playing) raf = deps.requestFrame(tick);
  }

  function stop() {
    playing = false;
    if (raf) deps.cancelFrame(raf);
    raf = 0;
  }

  function release() {
    stop();
    observer?.disconnect();
    observer = null;
    canvas.removeEventListener("webglcontextlost", onContextLost);
    scene?.dispose();
    scene = null;
    environment?.dispose();
    environment = null;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
    renderer = null;
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    stop();
    options.onContextLost?.();
  }

  function play(at = 0) {
    if (disposed || !scene || mode === "static") return;
    stop();
    paused = false;
    tNow = Math.max(0, at);
    t0 = null;
    playing = true;
    raf = deps.requestFrame(tick);
  }

  function pause() {
    if (!playing) return;
    stop();
    paused = true;
  }

  function resume() {
    if (!paused) return;
    play(tNow); // starts the clock at the time it stopped at; `play` clears the pause
  }

  const nextFrame = () => new Promise<void>((resolve) => deps.requestFrame(() => resolve()));

  const ready = (async () => {
    const lite = deps.isLite();
    renderer = deps.createRenderer(canvas, lite);
    environment = deps.createEnvironment(renderer);
    scene = createLogoScene(renderer, { lite, environment });
    canvas.addEventListener("webglcontextlost", onContextLost, { once: true });
    resize();
    // cold start: compile every program and draw once off screen, so that the first visible frame is t = 0
    await scene.compile();
    if (disposed) return release();
    draw(mode === "static" ? INTRO_DURATION : tNow);
    await nextFrame();
    if (disposed) return release();
    // The observer comes only now: its first notification would draw a frame while the programs are still linking
    // (three then waits for the link on the main thread, and the parallel compile is lost).
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        resize();
        if (!playing) draw(tNow);
      });
      observer.observe(canvas);
    }
    if (mode === "static") return finish();
    if (autoplay) play(tNow);
  })();
  ready.catch(() => {
    // the caller sees the rejection through `ready`; the GPU memory of a half-built scene is released here
    release();
  });

  return {
    ready,
    seek(t) {
      stop();
      tNow = Math.max(0, t);
      return draw(tNow) ?? { caption: { alpha: 0, x: 0, y: 0, fontPx: 0 } };
    },
    play,
    pause,
    resume,
    time: () => tNow,
    resize,
    dispose() {
      disposed = true;
      paused = false;
      if (scene) release();
    },
    duration: INTRO_DURATION,
    clicks: CLICKS,
  };
}
