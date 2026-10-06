/**
 * Site themes. Owner decision of 06.10.2026 (R-18, ADR-006): the site is night only, there is no switch, no choice by
 * local time and no stored choice. The `data-theme` attribute stays, so a second theme can come back by adding a
 * member here and a token set in tokens.ts; the themes.css rule is generated per member (build-css.mjs), components
 * stay untouched.
 */
export const themes = ["night"] as const;
export type Theme = (typeof themes)[number];

/** The server-rendered `<html data-theme>`. */
export const defaultTheme: Theme = "night";
