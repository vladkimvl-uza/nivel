import { createThemeController, type ThemeController } from "./controller.ts";
import { defaultTheme } from "./ids.ts";
import type { StorageLike } from "./select.ts";

/** Event on `window` after every change of the theme; `detail` is the theme id. For the 3D scene and analytics. */
export const THEME_EVENT = "nv-theme";

/** `localStorage` is a getter that can throw (blocked cookies); the answer is then "no storage". */
function storageOf(win: Window): StorageLike | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

function setMetaThemeColor(doc: Document, color: string): void {
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement("meta");
    meta.setAttribute("name", "theme-color");
    doc.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

/** A controller that does nothing: for server rendering, where there is no document to switch. */
export function createInertThemeController(): ThemeController {
  return {
    init: () => defaultTheme,
    get: () => defaultTheme,
    getServer: () => defaultTheme,
    set: () => {},
    toggle: () => defaultTheme,
    subscribe: () => () => {},
  };
}

/** The controller wired to the real page; without a window (server render) it is inert. */
export function createBrowserThemeController(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): ThemeController {
  if (!win) return createInertThemeController();
  const doc = win.document;
  return createThemeController({
    root: doc.documentElement,
    storage: storageOf(win),
    search: win.location.search,
    setThemeColor: (color) => setMetaThemeColor(doc, color),
    emit: (theme) => win.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme })),
    reducedMotion: () => win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    schedule: (fn, ms) => win.setTimeout(fn, ms),
    cancel: (handle) => win.clearTimeout(handle as number),
  });
}
