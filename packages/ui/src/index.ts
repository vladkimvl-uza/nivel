// Design system "Night and day" (decision R-18): tokens, two themes, fonts, primitives. Owner: WP-09
// (docs/design/day-night/DESIGN_SYSTEM.md is the source of the values).
//
// Styles are CSS, imported once by the app: `src/styles/index.css` (themes, @font-face, base, primitives).
// The theme is switched by `<html data-theme="day|night">`; components never know it.
export { fontFaceCss, fontFaces, fontFile, fontLicenses, legacyFontFiles, requiredGlyphs } from "./fonts/catalog.ts";
export { formatAmount, formatBp, MINUS, NBSP } from "./format/format.ts";
export { Badge, type BadgeKind, badgeKinds, Tag } from "./primitives/Badge.tsx";
export { Button, type ButtonProps, Mark } from "./primitives/Button.tsx";
export { type EstimateLabels, EstimateRow, EstimateTable } from "./primitives/Estimate.tsx";
export { Select, type SelectOption, type SelectProps, TextField, type TextFieldProps } from "./primitives/Field.tsx";
export { Money } from "./primitives/Money.tsx";
export { Paper } from "./primitives/Paper.tsx";
export { INK_FILTER_ID, RoundStamp, Stamp, StampInkDefs } from "./primitives/Stamp.tsx";
export { type SumKind, type SumLine, SumsTable } from "./primitives/SumsTable.tsx";
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
export { ThemeInitScript, themeInitScript } from "./theming/init-script.ts";
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
export { type ThemeContextValue, ThemeProvider, useTheme } from "./theming/ThemeProvider.tsx";
export { ThemeToggle, type ThemeToggleLabels, ThemeToggleView } from "./theming/ThemeToggle.tsx";
export { font, motion, radius, space } from "./tokens.ts";
