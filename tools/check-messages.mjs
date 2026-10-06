// Message catalogs: same keys in uz and ru, a meta entry per key, same ICU placeholders, length limits from meta,
// no "$" or "USD" (ARCHITECTURE 5.2). Owner after WP-00 — WP-08.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, ROOT } from "./lib/env.mjs";

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );
}

/** Top-level ICU argument names: "{count, plural, ...}" → count, "{name}" → name. */
export function placeholders(message) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const c = message[i];
    if (c === "{") {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z_][\w]*)/.exec(message.slice(i));
        if (m) names.add(m[1]);
      }
      depth++;
    } else if (c === "}") depth = Math.max(0, depth - 1);
  }
  return [...names].sort();
}

export function checkNamespace(ns, uz, ru, meta) {
  const out = [];
  const u = new Map(flatten(uz));
  const r = new Map(flatten(ru));
  for (const k of u.keys()) if (!r.has(k)) out.push(`${ns}: key "${k}" missing in ru`);
  for (const k of r.keys()) if (!u.has(k)) out.push(`${ns}: key "${k}" missing in uz`);
  for (const [k, uzText] of u) {
    const ruText = r.get(k);
    const m = meta?.[k];
    if (!m) out.push(`${ns}: key "${k}" has no meta entry (context, maxLen, status)`);
    if (ruText !== undefined && placeholders(uzText).join() !== placeholders(ruText).join()) {
      out.push(`${ns}: key "${k}" placeholders differ: uz {${placeholders(uzText)}} vs ru {${placeholders(ruText)}}`);
    }
    for (const [lang, text] of [
      ["uz", uzText],
      ["ru", ruText],
    ]) {
      if (text === undefined) continue;
      if (m?.maxLen && text.length > m.maxLen) out.push(`${ns}: ${lang} "${k}" is ${text.length} > maxLen ${m.maxLen}`);
      if (/\$|\bUSD\b/.test(text)) out.push(`${ns}: ${lang} "${k}" mentions dollars; prices are in sums only`);
    }
  }
  return out;
}

export function checkMessages(root = ROOT) {
  const base = join(root, "packages", "i18n", "messages");
  if (!existsSync(base)) return [];
  const namespaces = new Set(
    ["uz", "ru"].flatMap((l) =>
      existsSync(join(base, l)) ? readdirSync(join(base, l)).filter((f) => f.endsWith(".json")) : [],
    ),
  );
  const read = (l, f) => (existsSync(join(base, l, f)) ? JSON.parse(readFileSync(join(base, l, f), "utf8")) : null);
  return [...namespaces].flatMap((f) => {
    const ns = f.replace(/\.json$/, "");
    const uz = read("uz", f);
    const ru = read("ru", f);
    const meta = read("meta", f);
    if (!uz || !ru) return [`${ns}: file missing in ${uz ? "ru" : "uz"}`];
    if (!meta) return [`${ns}: meta/${f} is missing`];
    return checkNamespace(ns, uz, ru, meta);
  });
}

if (isMain(import.meta.url)) {
  const problems = checkMessages();
  if (problems.length > 0) {
    console.error(`check-messages: ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("check-messages: uz/ru keys, placeholders and limits OK");
}
