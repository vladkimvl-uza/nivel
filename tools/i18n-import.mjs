// Imports the translator's XLSX into packages/i18n/messages/uz (WP-08, Р-25). Every changed row is checked (keys, ICU
// placeholders, limits from meta, apostrophes, glossary); one error means nothing is written.
// Usage: node tools/i18n-import.mjs <file.xlsx> [--dry-run] [--normalize] [--ns a,b] [--root dir]
import { normalizeUz } from "../packages/domain/src/text/uz.ts";
import { runImport } from "../packages/i18n/src/cli.ts";
import { isMain, ROOT } from "./lib/env.mjs";

export { runImport };

if (isMain(import.meta.url)) {
  process.exit(runImport(["--root", ROOT, ...process.argv.slice(2)], console, { normalizeUz }));
}
