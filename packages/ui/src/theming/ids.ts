/** Site themes: one studio at two times of day (decision R-18). Switched by `<html data-theme>` without touching components. */
export const themes = ["day", "night"] as const;
export type Theme = (typeof themes)[number];

/** Used for the server-rendered attribute, before the visitor's local time or saved choice is known. */
export const defaultTheme: Theme = "day";

export function isTheme(value: unknown): value is Theme {
  return value === "day" || value === "night";
}
