// Non-color design tokens (DESIGN_SYSTEM 2.2). Colors live in themes/tokens.ts: raw colors are allowed only there.

export const font = {
  display: '"Brygada 1918", Georgia, serif',
  sans: '"Fira Sans", "Segoe UI", Arial, sans-serif',
  cond: '"Fira Sans Extra Condensed", "Fira Sans", Arial, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
  /** In IBM Plex Mono the Uzbek sign U+02BB looks like an acute accent: html[lang="uz-Latn"] uses this stack. */
  monoUz: '"Noto Sans Mono", ui-monospace, Consolas, monospace',
} as const;

export const space = {
  /** Side gutter: 16 px on a phone, 56 px at most. */
  gut: "clamp(16px, 4vw, 56px)",
  max: 1320,
  head: 68,
  section: "clamp(80px, 10vw, 140px)",
  block: "clamp(40px, 5vw, 64px)",
  /** The only steps used inside components. */
  steps: [4, 8, 12, 16, 20, 24, 32, 40, 56, 80],
} as const;

/** Buttons, chips and tags 2 px; cards 3 px; documents (paper) have none. */
export const radius = { r1: 2, r2: 3 } as const;

export const motion = {
  /** Milliseconds. `theme` is the page color change, `sceneTheme` the scene light change. */
  dur: { fast: 150, base: 300, slow: 600, theme: 900, sceneTheme: 1200 },
  ease: {
    out: "cubic-bezier(.2,.7,.2,1)",
    io: "cubic-bezier(.65,0,.35,1)",
    stamp: "cubic-bezier(.2,1.4,.4,1)",
  },
} as const;
