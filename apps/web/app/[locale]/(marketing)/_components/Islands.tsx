"use client";

import { useEffect } from "react";
import type { SiteConfig } from "../../../../src/i18n/site/client/config.ts";
import { fallBackToStatic } from "../../../../src/i18n/site/client/fallback.ts";

/**
 * Starts the scripts of the page after it has loaded and the browser is idle (BUILD_PLAN WP-16: the scripts of the scroll and of
 * the background are lazy; they are not part of the first load). Until then the page is complete HTML: the first poster, the
 * captions, the documents. Renders nothing.
 */
export function Islands({ config }: { config: SiteConfig }) {
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const start = () => {
      // A chunk that does not come (network, a release that replaced it) must not leave the page half switched on: the
      // blocks hidden for the reveal would stay hidden. The page goes back to its static view.
      void import("../../../../src/i18n/site/client/boot.ts")
        .then((m) => {
          if (!cancelled) stop = m.boot(config);
        })
        .catch((error: unknown) => fallBackToStatic(window, "boot", error));
    };
    const idle = () => {
      const ric = window.requestIdleCallback;
      if (ric) ric(start, { timeout: 1500 });
      else window.setTimeout(start, 200);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", idle);
      stop?.();
    };
  }, [config]);
  return null;
}
