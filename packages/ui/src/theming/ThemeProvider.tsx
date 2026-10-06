"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { createBrowserThemeController } from "./browser.ts";
import type { ThemeController } from "./controller.ts";
import type { Theme } from "./ids.ts";

export interface ThemeContextValue {
  theme: Theme;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Keeps React in step with `data-theme` on the root element. The attribute is the truth and is set before the first
 * paint by `ThemeInitScript`; this provider only reads it, switches it on request and remembers the choice.
 * Components never read the theme: they use `var(--role)` and the page recolors itself.
 */
export function ThemeProvider({
  children,
  controller,
}: {
  children?: ReactNode;
  /** For tests; by default the controller of the real page. */
  controller?: ThemeController | undefined;
}) {
  const ctrl = useMemo(() => controller ?? createBrowserThemeController(), [controller]);
  // The server snapshot is the default theme, so that hydration matches the markup the server sent.
  const theme = useSyncExternalStore(ctrl.subscribe, ctrl.get, ctrl.getServer);
  // The page works without the inline script too: the same rule resolves the theme once after mounting.
  useEffect(() => {
    ctrl.init();
  }, [ctrl]);
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (t) => ctrl.set(t),
      toggleTheme: () => {
        ctrl.toggle();
      },
    }),
    [ctrl, theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
