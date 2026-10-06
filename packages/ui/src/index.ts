// Design system "Night" (decision R-18, night only since 06.10.2026): tokens, one theme, fonts. Owner: WP-09
// (docs/design/day-night/DESIGN_SYSTEM.md is the source of the values).
//
// This is the CORE entry: plain .ts files, no react, no JSX. It loads in plain Node (`node src/main.ts` of the
// worker and bot, the PDF renderer takes brand colors and TTF names here) and in the browser alike.
// React parts (primitives) are the second entry, `./react.ts` (package path `@nivel/ui/react`); a test loads this
// file in a clean Node and checks the split.
//
// Styles are CSS, imported once by the app: `src/styles/index.css` (themes, @font-face, base, primitives).
// The page carries `<html data-theme="night">` (`defaultTheme`); there is no switch, and components never know it.
export { fontFaceCss, fontFaces, fontFile, fontLicenses, legacyFontFiles, requiredGlyphs } from "./fonts/catalog.ts";
export { formatAmount, formatBp, MINUS, NBSP } from "./format/format.ts";
export { escapeXml, type LogoSvgKind, type LogoSvgOptions, logoSvg } from "./logo/svg.ts";
export { type BadgeKind, badgeKinds } from "./primitives/kinds.ts";
export { compositeOver, contrastRatio, parseColor, relativeLuminance } from "./themes/contrast.ts";
export { defaultTheme, type Theme, themes } from "./themes/ids.ts";
export { sceneLight } from "./themes/scene-light.ts";
export { buildThemesCss, cssVarName } from "./themes/to-css.ts";
export { brand, type ThemeTokens, themeTokens } from "./themes/tokens.ts";
export { font, motion, radius, space } from "./tokens.ts";
