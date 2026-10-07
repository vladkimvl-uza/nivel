// The clips of the stages of the background (docs/design/hero-video/bg.js): the purchase, the assembly and the test. The scroll
// scrubs a clip (the share of the stage is the time in the clip); when the scroll stops, the clip plays on by itself up to a
// stop that the page sets (the receipts that have come, the end of the chapter of the item that is set). The test is a loop.
// Under reduced motion nothing plays; a hidden tab pauses everything.

export interface ClipVideo {
  duration: number;
  currentTime: number;
  readonly seeking?: boolean;
  loop: boolean;
  classList: { toggle(name: string, force?: boolean): boolean };
  addEventListener(type: string, listener: () => void): void;
  play(): Promise<void> | void;
  pause(): void;
  requestVideoFrameCallback?: (callback: () => void) => number;
}

export interface ClipDeps {
  /** Makes the `<video>` for a stage, with its address, and puts it on the stage. */
  create(key: string): ClipVideo;
  /** Takes the video off the stage and lets its memory go. */
  release(video: ClipVideo): void;
  timeout(callback: () => void, ms: number): unknown;
  hidden(): boolean;
  reduced: boolean;
}

interface Clip {
  key: string;
  v: ClipVideo;
  ok: boolean;
  busy: boolean;
  last: number;
  /** The time the scroll wants, plus what the clip has played by itself. */
  t: number;
  /** Where the scroll put the clip last time. */
  ps: number;
  /** How much the clip has played ahead of the scroll. */
  ex: number;
  playing: boolean;
  stop: number;
  loop: boolean;
}

const FPS = 25;

export interface ClipManager {
  get(key: string): ClipVideo;
  /** The share of the stage (0..1) is the position in the clip. */
  set(key: string, share: number): void;
  /** The clip plays by itself no further than this many seconds from its start (0 = it does not play by itself). */
  stop(key: string, seconds: number): void;
  drop(key: string): void;
  dropAll(): void;
  pauseAll(): void;
  /** No clip is the current one (the stage is a still). */
  hide(): void;
  current(): string;
  has(key: string): boolean;
  /** The scroll moved: the clip waits for it to stop again. */
  bump(): void;
  /** The tab came back. */
  resume(): void;
}

export function createClips(deps: ClipDeps): ClipManager {
  const clips: Record<string, Clip> = {};
  let current = "";
  let token = 0;
  let armed = false;

  function seek(c: Clip): void {
    if (!c.ok || c.busy || c.playing) return;
    const d = c.v.duration || 0;
    const t = d ? Math.min(c.t, d - 0.02) : c.t;
    const n = Math.round(t * FPS);
    if (n === c.last) return;
    c.last = n;
    c.busy = true;
    try {
      c.v.currentTime = n / FPS + 0.004;
    } catch {
      c.busy = false;
    }
  }

  function show(): void {
    for (const [key, c] of Object.entries(clips)) c.v.classList.toggle("is-on", key === current && c.ok);
  }

  function pauseOne(c: Clip | undefined): void {
    if (c?.playing) {
      c.playing = false;
      c.v.pause();
    }
  }

  function playOne(c: Clip): void {
    if (c.playing || !c.ok || deps.hidden() || deps.reduced) return;
    c.playing = true;
    c.busy = false;
    const result = c.v.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        c.playing = false;
      });
    }
  }

  function idle(): void {
    const c = clips[current];
    if (!c?.ok) return;
    if (c.loop || (c.t < (c.v.duration || 0) - 0.08 && !(c.stop && c.t >= c.stop - 0.06))) playOne(c);
  }

  function arm(): void {
    if (armed) return;
    armed = true;
    const mine = token;
    deps.timeout(() => {
      armed = false;
      if (mine === token) idle();
      else arm();
    }, 450);
  }

  function make(key: string): Clip {
    const v = deps.create(key);
    const c: Clip = {
      key,
      v,
      ok: false,
      busy: false,
      last: -1,
      t: 0,
      ps: -1,
      ex: 0,
      playing: false,
      stop: 0,
      loop: key === "t",
    };
    clips[key] = c;
    if (c.loop) v.loop = true;
    v.addEventListener("loadeddata", () => {
      c.ok = true;
      c.last = -1;
      seek(c);
      show();
      arm();
    });
    v.addEventListener("seeked", () => {
      c.busy = false;
      seek(c);
    });
    v.addEventListener("emptied", () => {
      c.ok = false;
      c.busy = false;
      c.last = -1;
    });
    v.addEventListener("ended", () => {
      if (c.playing) {
        c.playing = false;
        c.ex = Math.max(0, (v.duration || 0) - c.ps);
      }
    });
    const atStop = () => {
      if (c.playing && c.stop && v.currentTime >= c.stop - 0.03) {
        c.playing = false;
        v.pause();
        c.ex = Math.max(0, v.currentTime - c.ps);
        c.t = v.currentTime;
      }
    };
    v.addEventListener("timeupdate", atStop);
    if (v.requestVideoFrameCallback) {
      const onFrame = () => {
        atStop();
        if (clips[key] === c) v.requestVideoFrameCallback?.(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    }
    return c;
  }

  const ensure = (key: string): Clip => clips[key] ?? make(key);

  return {
    get: (key) => ensure(key).v,
    set(key, share) {
      current = key;
      const c = ensure(key);
      for (const other of Object.values(clips)) if (other !== c) pauseOne(other);
      if (c.loop) {
        show();
        arm();
        return;
      }
      const d = c.v.duration || 2.4;
      const ts = share * d;
      if (c.ps < 0) c.ps = ts;
      const dp = ts - c.ps;
      c.ps = ts;
      if (dp) {
        if (c.playing) {
          c.ex = Math.max(0, c.v.currentTime - ts);
          pauseOne(c);
        }
        if (dp < 0) c.ex = Math.max(0, c.ex + 2 * dp);
      }
      c.t = Math.min(d, ts + c.ex);
      seek(c);
      show();
    },
    stop(key, seconds) {
      const c = clips[key];
      if (!c) return;
      c.stop = deps.reduced ? 0 : seconds;
      if (c.playing && c.v.currentTime >= c.stop - 0.03) pauseOne(c);
      arm();
    },
    drop(key) {
      const c = clips[key];
      if (!c) return;
      pauseOne(c);
      deps.release(c.v);
      delete clips[key];
      if (current === key) current = "";
    },
    dropAll() {
      for (const key of Object.keys(clips)) this.drop(key);
      current = "";
    },
    pauseAll() {
      for (const c of Object.values(clips)) pauseOne(c);
    },
    hide() {
      if (current) pauseOne(clips[current]);
      current = "";
      show();
    },
    current: () => current,
    has: (key) => key in clips,
    bump() {
      token += 1;
      arm();
    },
    resume() {
      arm();
    },
  };
}
