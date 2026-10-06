// Regenerates the CSS that is derived from TypeScript sources of the package:
//   src/styles/fonts.css   from src/fonts/catalog.ts
//   src/themes/themes.css  from src/themes/tokens.ts
// Run after a change:  pnpm exec node packages/ui/scripts/build-css.mjs   (a test fails when the files are stale).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fontFaceCss } from "../src/fonts/catalog.ts";

const out = (rel) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
writeFileSync(out("styles/fonts.css"), fontFaceCss());
console.info("ui: wrote src/styles/fonts.css");
