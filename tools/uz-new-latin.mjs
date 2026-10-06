// Converts the Uzbek messages to the new Latin alphabet (oʻ→ö, gʻ→ğ, sh→ş, ch→ç) into a separate folder for review.
// The law is not in force; nothing runs this automatically (ARCHITECTURE 5.2). Without --out it is a dry run.
// Usage: node tools/uz-new-latin.mjs [--out dir] [--exceptions words.json] [--root dir]
import { runNewLatin } from "../packages/i18n/src/cli.ts";
import { isMain, ROOT } from "./lib/env.mjs";

export { runNewLatin };

if (isMain(import.meta.url)) {
  process.exit(runNewLatin(["--root", ROOT, ...process.argv.slice(2)], console));
}
