// Uzbek strings use U+02BB after o/g (oʻ, gʻ) and U+02BC for the other apostrophe; never ' (U+0027), ’ (U+2019),
// ‘ (U+2018) or ` inside words (ARCHITECTURE 5.2, block 26). Owner after WP-00 — WP-08.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, ROOT } from "./lib/env.mjs";

const BAD = { "'": "U+0027", "’": "U+2019", "‘": "U+2018", "`": "U+0060" };
// A wrong apostrophe between two letters (Latin or Cyrillic).
const BAD_RE = /(?<=\p{L})['’‘`](?=\p{L})/gu;

export function suggest(word) {
  return word.replace(/([oOgG])['’‘`]/g, "$1ʻ").replace(/(?<=\p{L})['’‘`](?=\p{L})/gu, "ʼ");
}

/** Problems in one Uzbek string; `where` is a label for messages. */
export function checkUzString(where, value) {
  const out = [];
  for (const m of value.matchAll(BAD_RE)) {
    const start = value.slice(0, m.index).search(/\p{L}+$/u);
    const word = /^[\p{L}'’‘`]+/u.exec(value.slice(start === -1 ? m.index : start))?.[0] ?? m[0];
    out.push(`${where}: "${word}" has ${BAD[m[0]]} inside a word; use "${suggest(word)}"`);
  }
  return out;
}

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );
}

export function checkUzMessages(root = ROOT) {
  const dir = join(root, "packages", "i18n", "messages", "uz");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return flatten(data).flatMap(([key, value]) => checkUzString(`uz/${f} ${key}`, value));
  });
}

if (isMain(import.meta.url)) {
  const problems = checkUzMessages();
  if (problems.length > 0) {
    console.error(`check-uz-text: ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("check-uz-text: Uzbek apostrophes OK");
}
