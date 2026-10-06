/** Canonical form for comparing generated CSS with the file after `biome format` (spacing, hex case, leading zeros). */
export function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/(?<!\d)\.(\d)/g, "0.$1");
}

export interface CssRule {
  /** Selector list as written (or `from`/`to`/`50%` inside keyframes). */
  selector: string;
  /** The enclosing at-rule prelude, e.g. `@media (max-width:960px)`; empty at top level. */
  at: string;
  decls: [prop: string, value: string][];
}

/** A small CSS reader for the package's own stylesheets: rules and declarations, one level of at-rules deep. */
export function parseCss(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssRule[] = [];
  const walk = (src: string, at: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith("@") && /\{/.test(body)) walk(body, prelude);
      else out.push({ selector: prelude, at, decls: declarationsOf(body) });
      i = j;
    }
  };
  walk(text, "");
  return out;
}

function declarationsOf(body: string): [string, string][] {
  const decls: [string, string][] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const piece = body.slice(start, end);
    const at = piece.indexOf(":");
    if (at > 0) decls.push([piece.slice(0, at).trim().toLowerCase(), piece.slice(at + 1).trim()]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(body.length);
  return decls;
}
