// Exports the messages to an XLSX for the translator (WP-08, Р-25): ru source, context, limits, uz text, glossary.
// Usage: node tools/i18n-export.mjs [--out file.xlsx] [--ns a,b] [--root dir]
// Default file: .data/i18n/nivel-translations-<date>.xlsx
import { runExport } from "../packages/i18n/src/cli.ts";
import { isMain, ROOT } from "./lib/env.mjs";

export { runExport };

if (isMain(import.meta.url)) {
  process.exit(runExport(["--root", ROOT, ...process.argv.slice(2)], console));
}
