// The first screen in the browser: the scroll moves the captions, the step bars, the posters and the clip of the owner
// (docs/design/hero-video). `applyHero` is the part that writes to elements and is tested with plain objects; `startHero` is
// the wiring (the scroll, the video, the resize) that the e2e tests and the eyes check.

import { type HeroState, heroState, magnetTarget } from "../hero-model.ts";
import { decideGate, heroMode, type PosterSize, posterSize } from "../motion-gate.ts";
import type { SiteConfig } from "./config.ts";
import type { ElLike, Win } from "./dom.ts";
import { createScrubber, type Scrubber } from "./scrub.ts";

export interface HeroApplyEls {
  caps: ElLike[];
  /** The four step labels at the bottom (`li`) and, in the same order, the bars inside them. */
  steps: ElLike[];
  fills: ElLike[];
  /** The line «01 / 04 · Name» of a phone. */
  stepsNow: ElLike;
  /** The small estimate next to the second step; absent on a phone. */
  hdoc: ElLike | null;
  /** The dark curtain at the end of the track. */
  off: ElLike;
  hfoot: ElLike;
  /** The box that comes closer at the end. */
  media: ElLike;
}

export interface HeroMemo {
  cap: number;
  step: number;
  off: number;
  zoom: number;
  fills: string;
}

export const createHeroMemo = (): HeroMemo => ({ cap: -1, step: -1, off: -1, zoom: -1, fills: "" });

/** Which poster is shown for a step, and which ones must have their address by then. */
export function posterToShow(step: number, mode: "video" | "posters"): { show: number; load: number[] } {
  const load = [step];
  if (step < 3 && mode !== "video") load.push(step + 1);
  return { show: step, load };
}

/** The share of the pinned track that has gone above the window, 0..1. */
export function progressOf(rect: { top: number; height: number }, viewportHeight: number): number {
  const total = Math.max(1, rect.height - viewportHeight);
  return Math.min(1, Math.max(0, -rect.top / total));
}

/** Writes the state of the scroll into the elements; every write happens only when its value changed. */
export function applyHero(
  els: HeroApplyEls,
  s: HeroState,
  memo: HeroMemo,
  stepText: (step: number) => string,
  showPoster: (step: number) => void,
): void {
  if (s.cap !== memo.cap) {
    for (const [k, c] of els.caps.entries()) c.classList.toggle("is-on", k === s.cap);
    els.hdoc?.classList.toggle("is-on", s.docOn);
    memo.cap = s.cap;
  }
  if (s.step !== memo.step) {
    for (const [k, li] of els.steps.entries()) li.classList.toggle("is-on", k <= s.step);
    els.stepsNow.textContent = stepText(s.step);
    showPoster(s.step);
    memo.step = s.step;
  }
  const fills = s.fill.join(",");
  if (fills !== memo.fills) {
    els.fills.forEach((b, k) => {
      b.style.transform = `scaleX(${s.fill[k]})`;
    });
    memo.fills = fills;
  }
  if (s.zoom !== memo.zoom) {
    els.media.style.setProperty("--z", String(s.zoom));
    memo.zoom = s.zoom;
  }
  if (s.off !== memo.off) {
    els.off.style.opacity = String(s.off);
    els.hfoot.style.opacity = (1 - s.off).toFixed(3);
    memo.off = s.off;
  }
}

interface NavigatorExtras {
  connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
  deviceMemory?: number;
}

const all = <T extends Element>(root: ParentNode, selector: string): T[] => [...root.querySelectorAll<T>(selector)];

/** Starts the first screen; returns a function that stops it. Does nothing on a page served static. */
export function startHero(config: SiteConfig, win: Win = window): () => void {
  const doc = win.document;
  const root = doc.querySelector<HTMLElement>("[data-hero]");
  const track = root?.querySelector<HTMLElement>("[data-hero-track]");
  const media = root?.querySelector<HTMLElement>("[data-hero-media]");
  const off = root?.querySelector<HTMLElement>("[data-hero-off]");
  const hfoot = root?.querySelector<HTMLElement>("[data-hfoot]");
  const stepsNow = root?.querySelector<HTMLElement>("[data-steps-now]");
  if (
    !root ||
    !track ||
    !media ||
    !off ||
    !hfoot ||
    !stepsNow ||
    doc.documentElement.classList.contains("is-reduced")
  ) {
    return () => {};
  }
  const nav = win.navigator as Navigator & NavigatorExtras;
  const conn = nav.connection ?? {};
  const coarse = () => win.matchMedia("(pointer: coarse)").matches;
  const gateNow = () =>
    decideGate({
      motionOff: false,
      prefersReduced: win.matchMedia("(prefers-reduced-motion: reduce)").matches,
      saveData: conn.saveData === true,
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      deviceMemory: nav.deviceMemory,
    });
  const verdict = gateNow();
  let mode: "video" | "posters" = heroMode(verdict) === "video" ? "video" : "posters";
  if (heroMode(verdict) === "reduced") return () => {};

  const stepItems = all<HTMLElement>(root, "[data-steps] [data-step-i]");
  const fills = stepItems.map((li) => li.querySelector<HTMLElement>("b"));
  if (fills.some((b) => !b)) return () => {};
  const els: HeroApplyEls = {
    caps: all<HTMLElement>(root, "[data-cap]"),
    steps: stepItems,
    fills: fills.filter((b): b is HTMLElement => b !== null),
    stepsNow,
    hdoc: root.querySelector<HTMLElement>("[data-hdoc]"),
    off,
    hfoot,
    media,
  };
  const posters = all<HTMLImageElement>(root, "[data-poster]");
  const size = (): PosterSize => posterSize({ width: win.innerWidth, dpr: win.devicePixelRatio, coarse: coarse() });
  let currentSize = size();
  const memo = createHeroMemo();
  let lastStep = 0;

  const ensurePoster = (i: number) => {
    const img = posters[i];
    if (!img || (i === 0 && img.getAttribute("src"))) return;
    const url = config.hero.posters[currentSize][i];
    if (url && img.getAttribute("src") !== url) img.src = url;
  };
  const showPoster = (step: number) => {
    lastStep = step;
    const { show, load } = posterToShow(step, mode);
    for (const [i, img] of posters.entries()) img.classList.toggle("is-on", i === show);
    for (const i of load) ensurePoster(i);
  };
  const stepText = (step: number) =>
    config.hero.stepNow
      .replace("{n}", `0${step + 1}`)
      .replace("{name}", (config.hero.stepNames[step] ?? "").replace(/^\d\d /, ""));

  // ---- the clip: loaded into memory, scrubbed by the scroll ----
  let video: HTMLVideoElement | null = null;
  let scrubber: Scrubber | null = null;
  let blobUrl: string | null = null;
  let progress = 0;
  let magnetTimer = 0;

  // The state of the file: a download that is on its way is not "no clip". Without it every frame of a phone's scroll asked for
  // the file again; a download that was given up (dropped, resized) must not set its file on the video when it ends.
  let clip: "idle" | "loading" | "ready" = "idle";
  let clipToken = 0;
  let clipAbort: AbortController | null = null;

  const loadClip = (restart = false) => {
    if (!video || !scrubber) return;
    if (clip === "loading" && !restart) return;
    clipAbort?.abort();
    clipAbort = null;
    const token = ++clipToken;
    const url = config.hero.video[currentSize];
    video.classList.remove("is-ready");
    scrubber.reset();
    clip = "loading";
    const set = (src: string) => {
      if (token !== clipToken || !video) return;
      clip = "ready";
      video.src = src;
      video.load();
    };
    if (!win.fetch || !win.URL) return set(url);
    const abort = typeof win.AbortController === "function" ? new win.AbortController() : null;
    clipAbort = abort;
    win
      .fetch(url, abort ? { signal: abort.signal } : undefined)
      .then((r) => {
        if (!r.ok) throw new Error("no clip");
        return r.blob();
      })
      .then((blob) => {
        if (token !== clipToken) return;
        if (blobUrl) win.URL.revokeObjectURL(blobUrl);
        const next = win.URL.createObjectURL(blob);
        blobUrl = next;
        set(next);
      })
      .catch(() => set(url));
  };

  const dropClip = () => {
    clipToken += 1;
    clipAbort?.abort();
    clipAbort = null;
    clip = "idle";
    // a seek that was on its way will never say `seeked`: the scrubber must not wait for it
    scrubber?.reset();
    if (!video) return;
    video.classList.remove("is-ready");
    video.removeAttribute("src");
    video.load();
    if (blobUrl) win.URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  };

  const startVideo = () => {
    if (mode !== "video" || video) return;
    const g = gateNow();
    if (!g.ok) {
      mode = "posters";
      showPoster(lastStep);
      return;
    }
    const v = doc.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.tabIndex = -1;
    for (const a of ["playsinline", "disablepictureinpicture", "disableremoteplayback"]) v.setAttribute(a, "");
    media.appendChild(v);
    video = v;
    scrubber = createScrubber(v, {
      raf: (cb) => win.requestAnimationFrame(cb),
      timeout: (cb, ms) => win.setTimeout(cb, ms),
      onShow: () => v.classList.add("is-ready"),
    });
    v.addEventListener("loadedmetadata", () => {
      scrubber?.loaded();
      // iOS wakes the decoder only after play(); a clip without sound may do it
      if (coarse()) {
        const p = v.play();
        if (p) void p.then(() => v.pause()).catch(() => {});
      }
    });
    v.addEventListener("seeked", () => scrubber?.seeked());
    v.addEventListener("error", () => {
      mode = "posters";
      v.classList.remove("is-ready");
      showPoster(lastStep);
    });
    if ("requestVideoFrameCallback" in v) {
      const onFrame = () => {
        scrubber?.frameDrawn();
        v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    }
    scrubber.setTarget(heroState(progress).time);
    loadClip();
  };

  // ---- the scroll ----
  const settle = () => {
    if (!scrubber) return;
    const t = scrubber.state().target;
    const m = magnetTarget(t);
    if (m !== t) scrubber.setTarget(m);
  };
  const update = () => {
    progress = progressOf(track.getBoundingClientRect(), win.innerHeight);
    const s = heroState(progress);
    applyHero(els, s, memo, stepText, showPoster);
    if (mode === "video" && scrubber) {
      scrubber.setTarget(s.time);
      win.clearTimeout(magnetTimer);
      magnetTimer = win.setTimeout(settle, 160);
    }
    // a phone lets the clip go when the first screen is far above, and takes it back on the way up
    if (coarse() && video) {
      const far = track.getBoundingClientRect().bottom < -win.innerHeight;
      if (far && clip !== "idle") dropClip();
      else if (!far && clip === "idle") loadClip();
    }
  };
  let queued = 0;
  const onScroll = () => {
    if (queued) return;
    queued = win.requestAnimationFrame(() => {
      queued = 0;
      update();
    });
  };
  win.addEventListener("scroll", onScroll, { passive: true });
  const onResize = () => {
    const next = size();
    if (next === currentSize) return onScroll();
    currentSize = next;
    for (const [i, img] of posters.entries()) if (i > 0) img.removeAttribute("src");
    showPoster(lastStep);
    if (video && clip !== "idle") loadClip(true);
  };
  win.addEventListener("resize", onResize);
  update();

  // the clip is fetched on the first sign of life of the visitor, or when the browser is idle once more
  const signs = ["scroll", "wheel", "touchstart", "keydown", "pointerdown"] as const;
  const begin = () => {
    for (const e of signs) win.removeEventListener(e, begin, true);
    startVideo();
  };
  for (const e of signs) win.addEventListener(e, begin, { passive: true, capture: true });
  // Safari has no requestIdleCallback: the typing says it is always there, the browser knows better
  const hasIdle = (win as { requestIdleCallback?: unknown }).requestIdleCallback !== undefined;
  const idle = hasIdle ? win.requestIdleCallback(begin, { timeout: 2500 }) : win.setTimeout(begin, 1200);

  return () => {
    win.removeEventListener("scroll", onScroll);
    win.removeEventListener("resize", onResize);
    for (const e of signs) win.removeEventListener(e, begin, true);
    if (hasIdle) win.cancelIdleCallback(idle);
    else win.clearTimeout(idle);
    win.clearTimeout(magnetTimer);
    dropClip();
    video?.remove();
    video = null;
  };
}
