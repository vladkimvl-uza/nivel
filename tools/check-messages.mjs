// Message catalogs: same keys in uz and ru, a meta entry per key, same ICU placeholders, length limits from meta,
// no "$" or "USD" (ARCHITECTURE 5.2). Owner — WP-08; the rules live in packages/i18n/src/messages-check.ts.
// Usage: node tools/check-messages.mjs [--root dir]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { placeholders } from "../packages/i18n/src/icu.ts";
import { checkNamespace } from "../packages/i18n/src/messages-check.ts";
import { isMain, ROOT } from "./lib/env.mjs";

export { checkNamespace, placeholders };

export function checkMessages(root = ROOT) {
  const base = join(root, "packages", "i18n", "messages");
  if (!existsSync(base)) return [];
  const namespaces = new Set(
    ["uz", "ru"].flatMap((l) =>
      existsSync(join(base, l)) ? readdirSync(join(base, l)).filter((f) => f.endsWith(".json")) : [],
    ),
  );
  const problems = [];
  for (const f of [...namespaces].sort()) {
    const ns = f.replace(/\.json$/, "");
    const read = (l) => {
      const path = join(base, l, f);
      if (!existsSync(path)) return { missing: true };
      try {
        return { data: JSON.parse(readFileSync(path, "utf8")) };
      } catch (e) {
        problems.push(`${ns}: ${l}/${f} is not valid JSON: ${e.message}`);
        return { broken: true };
      }
    };
    const uz = read("uz");
    const ru = read("ru");
    const meta = read("meta");
    if (uz.broken || ru.broken || meta.broken) continue;
    if (uz.missing || ru.missing) {
      problems.push(`${ns}: file missing in ${uz.missing ? "uz" : "ru"}`);
      continue;
    }
    if (meta.missing) {
      problems.push(`${ns}: meta/${f} is missing`);
      continue;
    }
    problems.push(...checkNamespace(ns, uz.data, ru.data, meta.data));
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const problems = checkMessages(values.root ? resolve(values.root) : ROOT);
  if (problems.length > 0) {
    console.error(`check-messages: ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("check-messages: uz/ru keys, placeholders and limits OK");
}
