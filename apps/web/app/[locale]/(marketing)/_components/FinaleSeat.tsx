"use client";

import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";

// The intro of the logo, «Fit to tolerance» (R-17), is loaded only when the finale comes near the window. `LogoIntro` itself
// loads the 3D core with import() after the browser is idle and does nothing under reduced motion; here not even its own
// code is requested before it is needed, and never on a page served static.
const Intro = lazy(() => import("@nivel/ui/react").then((m) => ({ default: m.LogoIntro })));

/** The place of the mark in the finale: the still lockup (drawn by the server) until the window comes near, then the intro. */
export function FinaleSeat({ fallback, label }: { fallback: ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || document.documentElement.classList.contains("is-reduced") || !("IntersectionObserver" in window)) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          watch.disconnect();
        }
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={box} className="fin-seat">
      {armed ? (
        <Suspense fallback={fallback}>
          <Intro mode="hero" label={label} />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}
