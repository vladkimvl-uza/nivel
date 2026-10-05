// Semantic tokens, theme files b/a/v, fonts and primitives (ARCHITECTURE 5.7). Owner after WP-00 — WP-09.
/** Site themes switched at runtime by <html data-theme> (ops.settings.site.theme, default "b"). */
export const themes = ["b", "a", "v"] as const;
export type Theme = (typeof themes)[number];
export const defaultTheme: Theme = "b";
