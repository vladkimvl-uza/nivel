import type { ReactNode } from "react";
import { cx } from "../primitives/cx.ts";
import {
  type LogoShape,
  lockupMarkTransform,
  lockupSize,
  lockupViewBox,
  lockupWordTransform,
  markRockingCount,
  markShapes,
  markViewBox,
  wordShapes,
} from "./shapes.ts";

export interface LogoProps {
  /** Accessible name of the picture; default "Nivel" (the name is the same in Uzbek and Russian). */
  label?: string | undefined;
  /** The logo stands next to its own text (a link caption, a header title): hide it from screen readers. */
  decorative?: boolean | undefined;
  /** Pixel width of the picture; omitted, the SVG takes the width of its box (set it in CSS). */
  width?: number | undefined;
  className?: string | undefined;
}

/** Loader size range, px of the SVG width (the concept: 48-96; below 32 px the favicon is used). */
export const LOADER_SIZE = { min: 48, max: 96, default: 64 } as const;

/** Clamps a requested loader size to 48-96 px; a non-number gives the default. */
export function clampLoaderSize(size: number | undefined): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return LOADER_SIZE.default;
  return Math.round(Math.min(LOADER_SIZE.max, Math.max(LOADER_SIZE.min, size)));
}

const shapePaths = (shapes: readonly LogoShape[]): ReactNode[] =>
  shapes.map((s) => <path key={s.d} className={cx(s.role === "ink" ? "nv-logo__ink" : "nv-logo__accent")} d={s.d} />);

/** Name of the picture, or `undefined` when it is decorative (hidden from assistive technology). */
const nameOf = ({ label, decorative }: LogoProps): string | undefined => (decorative ? undefined : (label ?? "Nivel"));

/** The level mark (nivel-1) without the word, in the night colors of the tokens (`--ink`, `--accent`). */
export function LogoMark(props: LogoProps) {
  const { width, className, decorative } = props;
  return (
    <svg
      className={cx("nv-logo", "nv-logo--mark", className)}
      viewBox={markViewBox}
      {...(width === undefined ? {} : { width, height: width })}
      role={decorative ? undefined : "img"}
      aria-label={nameOf(props)}
      aria-hidden={decorative ? true : undefined}
      focusable={decorative ? "false" : undefined}
    >
      {shapePaths(markShapes)}
    </svg>
  );
}

/** Mark and word "nivel" in one box, as nivel-1-lockup-inverse.svg; the height follows the width. */
export function LogoLockup(props: LogoProps) {
  const { width, className, decorative } = props;
  const height =
    width === undefined ? undefined : Math.round((width * lockupSize.height * 100) / lockupSize.width) / 100;
  return (
    <svg
      className={cx("nv-logo", "nv-logo--lockup", className)}
      viewBox={lockupViewBox}
      {...(width === undefined ? {} : { width, height })}
      role={decorative ? undefined : "img"}
      aria-label={nameOf(props)}
      aria-hidden={decorative ? true : undefined}
      focusable={decorative ? "false" : undefined}
    >
      <g transform={lockupMarkTransform}>{shapePaths(markShapes)}</g>
      <g transform={lockupWordTransform}>{shapePaths(wordShapes)}</g>
    </svg>
  );
}

export interface LogoLoaderProps {
  /** The word "loading" in the language of the page (uz/ru): comes from the caller, never empty. */
  label: string;
  /** SVG width in px, clamped to 48-96 (default 64). */
  size?: number | undefined;
  className?: string | undefined;
}

/**
 * Loading indicator without WebGL: the shelf and the triangle rock around the apex by 5 degrees and settle on the
 * level line (CSS, 1.4 s, endless). Under `prefers-reduced-motion` the CSS stops the rocking and shows the label;
 * `aria-busy` is true all the time the indicator is on the page.
 */
export function LogoLoader({ label, size, className }: LogoLoaderProps) {
  if (typeof label !== "string" || label.trim() === "") {
    throw new Error("LogoLoader: label is required and must not be empty");
  }
  const px = clampLoaderSize(size);
  const rocking = markShapes.slice(0, markRockingCount);
  const fixed = markShapes.slice(markRockingCount);
  return (
    <span className={cx("nv-logo-loader", className)} role="status" aria-live="polite" aria-busy="true">
      <svg
        className="nv-logo-loader__mark"
        viewBox={markViewBox}
        width={px}
        height={px}
        aria-hidden="true"
        focusable="false"
      >
        <g className="nv-logo-loader__tilt">{shapePaths(rocking)}</g>
        {shapePaths(fixed)}
      </svg>
      <span className="nv-logo-loader__cap">{label}</span>
    </span>
  );
}
