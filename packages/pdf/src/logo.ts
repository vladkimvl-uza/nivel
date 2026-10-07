// The mark nivel-1 for the header: the SVG of @nivel/ui (`logoSvg`, the same shapes as the site) read into paths, so that the
// renderer draws vectors and the document carries no picture. The colors are the ink and the orange of the paper.
import { logoSvg } from "@nivel/ui";
import { palette } from "./theme.ts";

export interface LogoPath {
  fill: string;
  d: string;
  /** Transforms of the enclosing groups, outer first: `translate(...)`, `scale(...)`. */
  transforms: string[];
}

export interface LogoParts {
  viewBox: string;
  /** Width over height of the viewBox. */
  ratio: number;
  paths: LogoPath[];
}

export function logoParts(): LogoParts {
  const svg = logoSvg({ kind: "lockup", ink: palette.asphalt, accent: palette.signal, label: "" });
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (viewBox === undefined) throw new Error("the logo SVG has no viewBox");
  const box = viewBox.split(/\s+/).map(Number);
  const stack: string[][] = [];
  const paths: LogoPath[] = [];
  for (const m of svg.matchAll(/<g transform="([^"]+)">|<\/g>|<path fill="([^"]+)" d="([^"]+)"\/>/g)) {
    if (m[1] !== undefined) stack.push(m[1].match(/\w+\([^)]*\)/g) ?? []);
    else if (m[0] === "</g>") stack.pop();
    else paths.push({ fill: m[2] as string, d: m[3] as string, transforms: stack.flat() });
  }
  if (paths.length === 0) throw new Error("the logo SVG has no shapes");
  return { viewBox, ratio: (box[2] as number) / (box[3] as number), paths };
}
