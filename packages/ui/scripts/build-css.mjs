// Regenerates the CSS that is derived from TypeScript sources of the package:
//   src/styles/fonts.css   from src/fonts/catalog.ts
//   src/themes/themes.css  from src/themes/tokens.ts
// Run after a change:  pnpm exec node packages/ui/scripts/build-css.mjs   (a test fails when the files are stale).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fontFaceCss } from "../src/fonts/catalog.ts";
import { buildThemesCss } from "../src/themes/to-css.ts";

const out = (rel) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
const files = [out("styles/fonts.css"), out("themes/themes.css")];
writeFileSync(files[0], fontFaceCss());
writeFileSync(files[1], buildThemesCss());
// The repo is formatted by Biome (hex case, spacing): the generated files must pass `biome check` as they are.
const fmt = spawnSync(`pnpm exec biome format --write ${files.map((f) => `"${f}"`).join(" ")}`, {
  stdio: "inherit",
  shell: true,
});
if (fmt.status !== 0) process.exit(fmt.status ?? 1);
console.info("ui: wrote src/styles/fonts.css and src/themes/themes.css");
