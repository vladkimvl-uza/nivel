// A clip that the scroll scrubs (the first screen, and the clips of the stages of the background): the scroll sets the time, the
// browser draws the frame for it. The next seek is asked for only after the last one was drawn, so the queue of seeks never
// grows, and a big jump goes straight to its frame without the frames in between. The logic of docs/design/hero-video/index.html.
import { follow, frameFor } from "../hero-model.ts";

export interface VideoLike {
  currentTime: number;
  readonly duration: number;
  readonly seeking: boolean;
}

export interface ScrubberDeps {
  raf(callback: () => void): number;
  timeout(callback: () => void, ms: number): number;
  /** The first frame has been drawn: the clip may be shown over the poster. */
  onShow(): void;
}

export interface Scrubber {
  /** The time of the clip the scroll wants, seconds. */
  setTarget(seconds: number): void;
  /** `loadedmetadata`: the clip knows its length; start from the target. */
  loaded(): void;
  /** The seek was drawn (`requestVideoFrameCallback`). */
  frameDrawn(): void;
  /** `seeked` of the video. */
  seeked(): void;
  /** The seek that was asked for is over. */
  seekFinished(): void;
  /** A new file is going to be loaded. */
  reset(): void;
  state(): { current: number; target: number; seeking: boolean; ready: boolean };
}

export function createScrubber(video: VideoLike, deps: ScrubberDeps): Scrubber {
  let current = 0;
  let target = 0;
  let last = -1;
  let seeking = false;
  let ready = false;
  let show = false;
  let queued = false;

  function kick(): void {
    if (queued) return;
    queued = true;
    deps.raf(tick);
  }

  function tick(): void {
    queued = false;
    if (!ready) return;
    current = follow(current, target);
    const { frame, time } = frameFor(current, video.duration);
    if (!seeking && frame !== last) {
      seeking = true;
      last = frame;
      try {
        video.currentTime = time;
      } catch {
        seeking = false;
      }
    }
    if (current !== target || seeking) kick();
  }

  function finish(): void {
    seeking = false;
    if (show) {
      show = false;
      deps.onShow();
    }
    kick();
  }

  return {
    setTarget(seconds) {
      target = seconds;
      kick();
    },
    loaded() {
      ready = true;
      last = -1;
      show = true;
      current = target;
      kick();
    },
    frameDrawn() {
      if (seeking && !video.seeking) finish();
    },
    seeked() {
      if (seeking) {
        deps.timeout(() => {
          if (seeking && !video.seeking) finish();
        }, 40);
      }
    },
    seekFinished: finish,
    reset() {
      ready = false;
      seeking = false;
      last = -1;
    },
    state: () => ({ current, target, seeking, ready }),
  };
}
