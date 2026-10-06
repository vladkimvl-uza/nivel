import { assertText, cx } from "./cx.ts";

/** Id of the SVG filter that prints stamps unevenly, like ink; the CSS refers to it as `url(#ink)`. */
export const INK_FILTER_ID = "ink";

/**
 * Defines the `#ink` filter once per page (put it near the top of `<body>`). Noise as a mask: an uneven imprint,
 * with no blur and no glow.
 */
export function StampInkDefs() {
  return (
    <svg className="nv-ink-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <filter id={INK_FILTER_ID} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.7 1.8" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * Neutral stamp: a word and, below it, a date or a number. It has no business meaning of its own: what it confirms
 * is the caller's business ("Утверждено 05.10.2026 · 15:02", "Сдано 12.10.2026 · NV-0001"). A stamp with a date
 * belongs inside an example document that is marked as one. `rect` and `RoundStamp` are drawn for paper
 * (`Paper`) only; `small` also works on the page (it takes the accent ink there).
 */
export function Stamp({
  word,
  meta,
  variant = "rect",
  tilt,
  decorative = false,
  className,
}: {
  word: string;
  meta?: string | undefined;
  /** `rect` is the double frame; `small` is for the steps of "How we work". */
  variant?: "rect" | "small" | undefined;
  tilt?: "left" | "right" | undefined;
  /** Hide from screen readers when the same words are written next to the stamp. */
  decorative?: boolean | undefined;
  className?: string | undefined;
}) {
  assertText(word, "word", "Stamp");
  const hidden = decorative ? true : undefined;
  const tiltClass = tilt && `nv-stamp--tilt-${tilt}`;
  if (variant === "small") {
    return (
      <div className={cx("nv-sstamp", tiltClass, className)} aria-hidden={hidden}>
        <b>{word}</b>
        {meta ? <i>{meta}</i> : null}
      </div>
    );
  }
  return (
    <div className={cx("nv-stamp-r", tiltClass, className)} aria-hidden={hidden}>
      <span>
        <b>{word}</b>
        {meta ? <em>{meta}</em> : null}
      </span>
    </div>
  );
}

/** Round stamp of the passport: text along the circle, the mark and a date in the middle. */
export function RoundStamp({
  id,
  ring,
  date,
  label,
  className,
}: {
  /** Unique on the page: the circular path that the text runs along. */
  id: string;
  /** Text around the circle, e.g. "NIVEL · ТАШКЕНТ · ТЕСТ ПРОЙДЕН · 8 Ч ·". */
  ring: string;
  date: string;
  /** Accessible name of the whole stamp. */
  label: string;
  className?: string | undefined;
}) {
  assertText(id, "id", "RoundStamp");
  assertText(label, "label", "RoundStamp");
  return (
    <svg className={cx("nv-rstamp", className)} viewBox="0 0 150 150" role="img" aria-label={label}>
      <defs>
        <path id={id} d="M75 75m-54 0a54 54 0 1 1 108 0a54 54 0 1 1 -108 0" />
      </defs>
      <circle cx="75" cy="75" r="70" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <circle cx="75" cy="75" r="40" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text className="nv-rstamp__ring" fill="currentColor">
        <textPath href={`#${id}`}>{ring}</textPath>
      </text>
      <g transform="translate(55 50) scale(.62)" fill="currentColor">
        <path d="M8 16h52v8h-52Z" />
        <path d="M8 24L24 24L24 40Z" />
        <path d="M24 24L40 24L24 40Z" opacity=".55" />
        <path d="M4 40h56v8h-56Z" />
      </g>
      <text className="nv-rstamp__date" x="75" y="104" textAnchor="middle" fill="currentColor">
        {date}
      </text>
    </svg>
  );
}
