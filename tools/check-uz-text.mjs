// Uzbek strings use U+02BB after o/g (oʻ, gʻ) and U+02BC for the other apostrophe; never ' (U+0027), ’ (U+2019),
// ‘ (U+2018) or ` inside words (ARCHITECTURE 5.2, block 26). Owner — WP-08; the rules live in
// packages/i18n/src/uz-apostrophes.ts. Also scans the Uzbek terms of the glossary seed.
// Usage: node tools/check-uz-text.mjs [--root dir]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { flattenMessages } from "../packages/i18n/src/messages-check.ts";
import { checkUzString, suggestUz } from "../packages/i18n/src/uz-apostrophes.ts";
import { isMain, ROOT } from "./lib/env.mjs";

export { checkUzString };
export const suggest = suggestUz;

export function checkUzMessages(root = ROOT) {
  const dir = join(root, "packages", "i18n", "messages", "uz");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const problems = files.flatMap((f) => {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return flattenMessages(data).flatMap(([key, value]) => checkUzString(`uz/${f} ${key}`, value));
  });
  const glossary = join(root, "packages", "db", "seed", "glossary", "glossary.json");
  if (existsSync(glossary)) {
    for (const term of JSON.parse(readFileSync(glossary, "utf8"))) {
      problems.push(...checkUzString(`glossary #${term.no} termUz`, term.termUz));
    }
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const problems = checkUzMessages(values.root ? resolve(values.root) : ROOT);
  if (problems.length > 0) {
    console.error(`check-uz-text: ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("check-uz-text: Uzbek apostrophes OK");
}
