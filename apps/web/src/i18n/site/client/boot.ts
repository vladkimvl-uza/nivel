// The entry of the scripts of the page: it is loaded by `Islands` after the page has loaded and the browser is idle, and starts the
// small things, the first screen and, when the reader comes near it, the background. The first screen and the background are
// separate chunks that are requested only when they are needed.

import { startChrome } from "./chrome.ts";
import type { SiteConfig } from "./config.ts";
import type { Win } from "./dom.ts";

/** How many screens of scroll before the end of the first screen the background is loaded. */
const NEAR_SCREENS = 2;
/** The background is loaded this long after the page was ready even if the reader has not scrolled. */
const LATE_MS = 5000;

export function boot(config: SiteConfig, win: Win = window): () => void {
  const doc = win.document;
  const stops: (() => void)[] = [startChrome(win)];
  let stopped = false;
  const keep = (stop: () => void) => {
    if (stopped) stop();
    else stops.push(stop);
  };

  if (!doc.documentElement.classList.contains("is-reduced")) {
    void import("./hero.ts").then((m) => keep(m.startHero(config, win)));
  }

  let bgStarted = false;
  const near = () => {
    const track = doc.querySelector("[data-hero-track]");
    if (!track || track.getBoundingClientRect().bottom < NEAR_SCREENS * win.innerHeight) startBackground();
  };
  const startBackground = () => {
    if (bgStarted) return;
    bgStarted = true;
    win.removeEventListener("scroll", near);
    void import("./bg.ts").then((m) => keep(m.startBg(config, win)));
  };
  win.addEventListener("scroll", near, { passive: true });
  const late = win.setTimeout(startBackground, LATE_MS);
  if (win.location.hash.length > 1 || config.reduced || doc.documentElement.classList.contains("is-reduced"))
    startBackground();
  else near();

  return () => {
    stopped = true;
    win.removeEventListener("scroll", near);
    win.clearTimeout(late);
    for (const stop of stops) stop();
  };
}
