import { describe, expect, it } from "vitest";
import { createScrubber, type VideoLike } from "./scrub.ts";

function setup(duration = 14.04) {
  const seeks: number[] = [];
  const video: VideoLike & { seekingNow: boolean } = {
    duration,
    seekingNow: false,
    get seeking() {
      return this.seekingNow;
    },
    set currentTime(t: number) {
      seeks.push(t);
    },
    get currentTime() {
      return seeks.at(-1) ?? 0;
    },
  };
  const frames: (() => void)[] = [];
  const timers: (() => void)[] = [];
  let shown = 0;
  const s = createScrubber(video, {
    raf: (cb) => frames.push(cb),
    timeout: (cb) => timers.push(cb),
    onShow: () => shown++,
  });
  const flush = (max = 50) => {
    for (let i = 0; i < max && frames.length > 0; i++) frames.shift()?.();
  };
  return { s, video, seeks, flush, timers, shown: () => shown };
}

describe("createScrubber", () => {
  it("does nothing until the clip has told its length", () => {
    const { s, seeks, flush } = setup();
    s.setTarget(5);
    flush();
    expect(seeks).toEqual([]);
    expect(s.state().ready).toBe(false);
  });

  it("goes to the target at once when the clip is ready, and shows the clip after the first seek", () => {
    const { s, seeks, flush, shown } = setup();
    s.setTarget(2);
    s.loaded();
    flush();
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeCloseTo(2.004, 6);
    expect(shown()).toBe(0);
    s.seekFinished();
    expect(shown()).toBe(1);
  });

  it("asks for the next frame only after the last one was drawn: the queue of seeks does not grow", () => {
    const { s, seeks, flush } = setup();
    s.loaded();
    s.setTarget(1);
    flush();
    s.setTarget(1.2);
    flush();
    s.setTarget(1.4);
    flush();
    expect(seeks).toHaveLength(1);
    s.seekFinished();
    flush();
    expect(seeks).toHaveLength(2);
  });

  it("chases the target in steps when the jump is small", () => {
    const { s, flush } = setup();
    s.loaded();
    s.setTarget(1);
    flush();
    s.seekFinished();
    s.setTarget(1.3);
    flush(1);
    expect(s.state().current).toBeCloseTo(1.09, 6);
  });

  it("goes straight to the target on a big jump", () => {
    const { s, flush } = setup();
    s.loaded();
    s.setTarget(1);
    flush();
    s.seekFinished();
    s.setTarget(9);
    flush(1);
    expect(s.state().current).toBe(9);
  });

  it("does not seek again for the same frame", () => {
    const { s, seeks, flush } = setup();
    s.loaded();
    s.setTarget(3);
    flush();
    s.seekFinished();
    s.setTarget(3.01);
    flush();
    expect(seeks).toHaveLength(1);
  });

  it("goes on after a seek that the browser refused", () => {
    const { s, video, flush } = setup();
    let first = true;
    Object.defineProperty(video, "currentTime", {
      set() {
        if (first) {
          first = false;
          throw new Error("not seekable");
        }
      },
      get: () => 0,
    });
    s.loaded();
    s.setTarget(2);
    flush();
    expect(s.state().seeking).toBe(false);
  });

  it("finishes a seek when a frame is drawn and the video is not seeking any more", () => {
    const { s, video, flush } = setup();
    s.loaded();
    s.setTarget(2);
    flush();
    expect(s.state().seeking).toBe(true);
    video.seekingNow = true;
    s.frameDrawn();
    expect(s.state().seeking).toBe(true);
    video.seekingNow = false;
    s.frameDrawn();
    expect(s.state().seeking).toBe(false);
  });

  it("finishes a seek shortly after the browser says `seeked`, if the video is not seeking any more", () => {
    const { s, video, flush, timers } = setup();
    s.loaded();
    s.setTarget(2);
    flush();
    s.seeked();
    expect(timers).toHaveLength(1);
    video.seekingNow = false;
    timers[0]?.();
    expect(s.state().seeking).toBe(false);
  });

  it("starts from the current target when the clip is loaded again (the colour or the size changed)", () => {
    const { s, seeks, flush } = setup();
    s.setTarget(4);
    s.loaded();
    flush();
    expect(seeks[0]).toBeCloseTo(4.004, 6);
    s.reset();
    expect(s.state().ready).toBe(false);
  });
});
