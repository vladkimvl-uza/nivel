import { themeTokens } from "../themes/tokens.ts";
import { defaultTheme, isTheme, type Theme } from "./ids.ts";
import { readStoredTheme, resolveTheme, type StorageLike, storeTheme, themeFromSearch } from "./select.ts";

/** The part of `document.documentElement` that is used. */
export interface RootLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  classList: { add(token: string): unknown; remove(token: string): unknown };
}

export interface ThemeControllerDeps {
  root: RootLike;
  storage?: StorageLike | null | undefined;
  now?: (() => Date) | undefined;
  /** `location.search`. */
  search?: string | undefined;
  /** Updates `<meta name="theme-color">`. */
  setThemeColor?: ((color: string) => void) | undefined;
  /** Tells the non-React world (the 3D scene) that the theme changed; `animate` is false when the colors do not fade. */
  emit?: ((theme: Theme, animate: boolean) => void) | undefined;
  reducedMotion?: (() => boolean) | undefined;
  schedule?: ((fn: () => void, ms: number) => unknown) | undefined;
  cancel?: ((handle: unknown) => void) | undefined;
}

export interface SetThemeOptions {
  /** Remember the choice (default). `false` for an automatic change. */
  persist?: boolean;
  /** Fade the colors for 1 s (default, unless the visitor prefers reduced motion). */
  animate?: boolean;
}

export interface ThemeController {
  /** Resolves the theme of the first paint (`?theme=`, saved choice, local time) and applies it. Once. */
  init(): Theme;
  /** The current theme: the attribute on the root element is the truth. */
  get(): Theme;
  /** Snapshot for server rendering and hydration: always the default theme. */
  getServer(): Theme;
  set(theme: Theme, options?: SetThemeOptions): void;
  toggle(): Theme;
  subscribe(listener: () => void): () => void;
}

/** The class that enables color transitions on every element for the time of the switch (see base.css). */
export const THEME_SHIFT_CLASS = "theme-shift";
export const THEME_SHIFT_MS = 1000;

/** Switching without a reload: `data-theme` on the root, colors fade for a second, the choice is remembered. */
export function createThemeController(deps: ThemeControllerDeps): ThemeController {
  const { root } = deps;
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let shiftTimer: unknown;
  let started = false;

  const get = (): Theme => {
    const value = root.getAttribute("data-theme");
    return isTheme(value) ? value : defaultTheme;
  };

  const startShift = () => {
    if (shiftTimer !== undefined) cancel(shiftTimer);
    root.classList.add(THEME_SHIFT_CLASS);
    shiftTimer = schedule(() => {
      root.classList.remove(THEME_SHIFT_CLASS);
      shiftTimer = undefined;
    }, THEME_SHIFT_MS);
  };

  const set = (theme: Theme, { persist = true, animate = true }: SetThemeOptions = {}): void => {
    if (!isTheme(theme)) throw new TypeError(`unknown theme: ${String(theme)}`);
    const changed = get() !== theme || root.getAttribute("data-theme") === null;
    const fade = animate && changed && !deps.reducedMotion?.();
    if (fade) startShift();
    root.setAttribute("data-theme", theme);
    deps.setThemeColor?.(themeTokens[theme].themeColor);
    if (persist) storeTheme(deps.storage, theme);
    if (changed) {
      deps.emit?.(theme, animate && !deps.reducedMotion?.());
      for (const listener of listeners) listener();
    }
  };

  return {
    init() {
      if (started) return get();
      started = true;
      const theme = resolveTheme({
        query: themeFromSearch(deps.search),
        stored: readStoredTheme(deps.storage),
        now: now(),
      });
      set(theme, { persist: false, animate: false });
      return theme;
    },
    get,
    getServer: () => defaultTheme,
    set,
    toggle() {
      const next: Theme = get() === "day" ? "night" : "day";
      set(next);
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
