/** Canonical form for comparing generated CSS with the file after `biome format` (spacing, hex case, leading zeros). */
export function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/(?<!\d)\.(\d)/g, "0.$1");
}
