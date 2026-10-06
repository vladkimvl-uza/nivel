// Design system "Night and day" (decision R-18): tokens, two themes, fonts. Owner: WP-09
// (docs/design/day-night/DESIGN_SYSTEM.md is the source of the values).
//
// This is the CORE entry: plain .ts files, no react, no JSX. It loads in plain Node (`node src/main.ts` of the
// worker and bot, the PDF renderer takes brand colors and TTF names here) and in the browser alike.
// React parts (primitives, ThemeProvider, ThemeToggle, ThemeInitScript) are the second entry, `./react.ts`
// (package path `@nivel/ui/react`); a test loads this file in a clean Node and checks the split.
//
// Styles are CSS, imported once by the app: `src/styles/index.css` (themes, @font-face, base, primitives).
// The theme is switched by `<html data-theme="day|night">`; components never know it.
export { fontFaceCss, fontFaces, fontFile, fontLicenses, legacyFontFiles, requiredGlyphs } from "./fonts/catalog.ts";
export { formatAmount, formatBp, MINUS, NBSP } from "./format/format.ts";
export { type BadgeKind, badgeKinds } from "./primitives/kinds.ts";
export { compositeOver, contrastRatio, parseColor, relativeLuminance } from "./themes/contrast.ts";
export { sceneLight } from "./themes/scene-light.ts";
export { buildThemesCss, cssVarName } from "./themes/to-css.ts";
export { brand, type ThemeTokens, themeTokens } from "./themes/tokens.ts";
export { createBrowserThemeController, createInertThemeController, THEME_EVENT } from "./theming/browser.ts";
export {
  createThemeController,
  type SetThemeOptions,
  THEME_SHIFT_CLASS,
  THEME_SHIFT_MS,
  type ThemeController,
  type ThemeControllerDeps,
} from "./theming/controller.ts";
export { defaultTheme, isTheme, type Theme, themes } from "./theming/ids.ts";
export { themeInitScript } from "./theming/init-script.ts";
export {
  DAY_FROM_HOUR,
  DAY_TO_HOUR,
  readStoredTheme,
  resolveTheme,
  type StorageLike,
  storeTheme,
  THEME_STORAGE_KEY,
  themeByLocalTime,
  themeFromSearch,
} from "./theming/select.ts";
export { font, motion, radius, space } from "./tokens.ts";
