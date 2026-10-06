/**
 * Site themes. Owner decision of 06.10.2026 (R-18, ADR-006): the site is night only, there is no switch, no choice by
 * local time and no stored choice. The `data-theme` attribute stays, so a second theme can come back by adding a
 * member here, a token set in tokens.ts and one rule in themes.css, without touching components.
 */
export const themes = ["night"] as const;
export type Theme = (typeof themes)[number];

/** The server-rendered `<html data-theme>`. */
export const defaultTheme: Theme = "night";
