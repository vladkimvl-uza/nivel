import { defaultTheme, isTheme, type Theme } from "./ids.ts";

/** localStorage key of the visitor's choice (the same as in the prototype). */
export const THEME_STORAGE_KEY = "nv-theme";

/** Day is 07:00-18:59 local time of the visitor, the rest is night (R-18). */
export const DAY_FROM_HOUR = 7;
export const DAY_TO_HOUR = 19;

/** The part of `Storage` that is used; a fake in tests, `localStorage` in the browser. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The theme for the local time of `now`; an invalid date gives the default theme. */
export function themeByLocalTime(now: Date): Theme {
  const hour = now.getHours();
  if (Number.isNaN(hour)) return defaultTheme;
  return hour >= DAY_FROM_HOUR && hour < DAY_TO_HOUR ? "day" : "night";
}

/** `?theme=day|night` from `location.search`, for checking; anything else is `null`. */
export function themeFromSearch(search: string | undefined): Theme | null {
  const value = new URLSearchParams(search ?? "").get("theme");
  return isTheme(value) ? value : null;
}

/** The saved choice. Storage may be absent, blocked or full: that is not an error, the answer is `null`. */
export function readStoredTheme(storage: StorageLike | null | undefined): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the choice; `false` when storage is absent, blocked or full. */
export function storeTheme(storage: StorageLike | null | undefined, theme: Theme): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export interface ThemeSources {
  /** `?theme=` of the address, for checking. */
  query?: string | null | undefined;
  /** The saved choice. */
  stored?: string | null | undefined;
  now: Date;
}

/** The theme of the first visit and every reload: `?theme=` over the saved choice over the local time. */
export function resolveTheme({ query, stored, now }: ThemeSources): Theme {
  if (isTheme(query)) return query;
  if (isTheme(stored)) return stored;
  return themeByLocalTime(now);
}
