// Plain-string SVG of the logo for code that has no React and no CSS: the PDF renderer, the worker, the bot.
// The colors are arguments (default: the night ink and accent of the tokens), so the file holds no raw HEX.
import { themeTokens } from "../themes/tokens.ts";
import {
  type LogoShape,
  lockupMarkTransform,
  lockupViewBox,
  lockupWordTransform,
  markShapes,
  markViewBox,
  wordShapes,
} from "./shapes.ts";

export type LogoSvgKind = "mark" | "lockup";

export interface LogoSvgOptions {
  readonly kind?: LogoSvgKind;
  /** Color of the body and the word; default is the night ink (paper). */
  readonly ink?: string;
  /** Color of the orange triangle and the dot; default is the night accent. */
  readonly accent?: string;
  /** Accessible name. An empty string makes the picture decorative (`aria-hidden`). Default "Nivel". */
  readonly label?: string;
  /** Pixel width; the height follows the viewBox. Omitted: the SVG takes the size of its box. */
  readonly width?: number;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapes text and attribute values of the generated markup. */
export const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] as string);

const paths = (shapes: readonly LogoShape[], ink: string, accent: string): string =>
  shapes.map((s) => `<path fill="${escapeXml(s.role === "ink" ? ink : accent)}" d="${s.d}"/>`).join("");

/** The logo as an SVG document string (night colors by default). */
export function logoSvg(options: LogoSvgOptions = {}): string {
  const { kind = "lockup", label = "Nivel", width } = options;
  const ink = options.ink ?? themeTokens.night.ink;
  const accent = options.accent ?? themeTokens.night.accent;
  const lockup = kind === "lockup";
  const viewBox = lockup ? lockupViewBox : markViewBox;
  const body = lockup
    ? `<g transform="${lockupMarkTransform}">${paths(markShapes, ink, accent)}</g>` +
      `<g transform="${lockupWordTransform}">${paths(wordShapes, ink, accent)}</g>`
    : paths(markShapes, ink, accent);
  const a11y = label === "" ? 'aria-hidden="true"' : `role="img" aria-label="${escapeXml(label)}"`;
  const size = width === undefined ? "" : ` width="${width}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size} ${a11y}>${body}</svg>`;
}
