"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "../primitives/cx.ts";
import { logoScene } from "../themes/logo-motion.ts";
import { defaultWhenIdle, type IntroDeps, type IntroPhase, startIntro } from "./intro-controller.ts";
import { introSession, prefersReducedMotion } from "./intro-session.ts";
import { constrainedNetwork, watchReducedMotion, watchVisible } from "./intro-watch.ts";
import { LogoLockup } from "./Logo.tsx";

export interface LogoIntroProps {
  /** Accessible name of the lockup; default "Nivel" (the same in Uzbek and Russian). */
  label?: string | undefined;
  /**
   * `intro` (default): the intro once per session, then the still lockup. `hero`: the intro and then a loop that goes
   * on (the first screen of the landing page).
   */
  mode?: "intro" | "hero" | undefined;
  className?: string | undefined;
  /** The intro may still start this long after the mount; a later 3D core means the still lockup stays (default 1200 ms). */
  introWindowMs?: number | undefined;
  /** The intro has played to its end (once per session). */
  onDone?: (() => void) | undefined;
  /** The 3D core could not start (offline, no WebGL); the still lockup stays. */
  onError?: ((error: unknown) => void) | undefined;
  /** Replaces the browser parts (loader, idle, storage, motion query) in tests. */
  deps?: Partial<IntroDeps> | undefined;
}

/**
 * The intro of the logo, "Fit to tolerance" (R-17). The server renders the still lockup: that is what a reader without
 * JavaScript, under reduced motion and on a repeat visit sees, and what stays under the first frame. After the browser
 * is idle the 3D core is loaded by import() (it carries three; this entry never imports it statically), and the intro
 * plays once per session, without sound. With `prefers-reduced-motion` there are no requests to three at all.
 *
 * Client component: it uses hooks. A Server Component may render it with plain props (`label`, `mode`, `className`,
 * `introWindowMs`); `onDone`, `onError` and `deps` are functions and cannot cross from the server (wrap it in your own
 * client component for them).
 *
 * Put it in a box with a size: the component fills its parent and keeps the lockup at 62 % of the width (80 % below 700 px).
 */
export function LogoIntro({
  label,
  mode = "intro",
  className,
  introWindowMs = 1200,
  onDone,
  onError,
  deps,
}: LogoIntroProps) {
  const [phase, setPhase] = useState<IntroPhase>("still");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captionRef = useRef<HTMLSpanElement>(null);
  // the latest callbacks and test deps without restarting the intro when the parent re-renders
  const latest = useRef({ onDone, onError, deps });
  latest.current = { onDone, onError, deps };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const run = startIntro(
      {
        mode,
        canvas,
        caption: captionRef.current,
        introWindowMs,
        onPhase: setPhase,
        onDone: () => latest.current.onDone?.(),
        onError: (error) => latest.current.onError?.(error),
      },
      {
        load: () => import("../logo-motion/index.ts"),
        whenIdle: defaultWhenIdle,
        now: () => performance.now(),
        session: introSession,
        reducedMotion: () => prefersReducedMotion(),
        constrained: () => constrainedNetwork(),
        watchVisible: (target, cb) => watchVisible(target, cb),
        watchReducedMotion: (cb) => watchReducedMotion(cb),
        ...latest.current.deps,
      },
    );
    return () => run.stop();
  }, [mode, introWindowMs]);

  return (
    <div className={cx("nv-logo-intro", className)} data-state={phase} style={{ backgroundImage: logoScene.stage }}>
      <LogoLockup className="nv-logo-intro__still" label={label} />
      {/* an empty canvas has no content for assistive technology; the name of the logo is on the still lockup, which
          stays in the accessibility tree while the canvas plays (it is see-through, not hidden) */}
      <canvas ref={canvasRef} className="nv-logo-intro__canvas" />
      <span ref={captionRef} className="nv-logo-intro__caption" aria-hidden="true">
        {"±0.000"}
      </span>
    </div>
  );
}
