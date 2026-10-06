// Consistency of one message namespace: same keys in uz and ru, meta for every key, same ICU arguments, limits from meta
// (ARCHITECTURE 5.2). Used by tools/check-messages.mjs and by the translator import.
import { checkIcuSyntax, placeholderSignature } from "./icu.ts";

export interface MetaEntry {
  context: string;
  maxLen: number;
  status: "draft" | "reviewed";
  screenshot?: string;
}

/** A message file: nested objects whose leaves are ICU strings. */
export interface MessageTree {
  [key: string]: string | MessageTree;
}

/** Leaf messages as [dotted key, text] in source order. Non-string leaves are kept as text of their JSON for reporting. */
export function flattenMessages(tree: unknown, prefix = ""): [string, string][] {
  if (!tree || typeof tree !== "object") return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? flattenMessages(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]],
  );
}

function leafTypeProblems(ns: string, tree: unknown, prefix = ""): string[] {
  if (!tree || typeof tree !== "object") return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) => {
    const path = `${prefix}${k}`;
    const out = k.includes(".") ? [`${ns}: key segment "${k}" must not contain a dot (use nesting)`] : [];
    if (v && typeof v === "object" && !Array.isArray(v)) return [...out, ...leafTypeProblems(ns, v, `${path}.`)];
    if (typeof v !== "string") out.push(`${ns}: key "${path}" must be a string`);
    return out;
  });
}

function metaProblems(ns: string, key: string, m: unknown): string[] {
  const o = (m ?? {}) as Partial<Record<keyof MetaEntry, unknown>>;
  const out: string[] = [];
  if (typeof o.context !== "string" || o.context.trim() === "")
    out.push(`${ns}: meta "${key}": context must be a non-empty string`);
  if (typeof o.maxLen !== "number" || !Number.isInteger(o.maxLen) || o.maxLen <= 0) {
    out.push(`${ns}: meta "${key}": maxLen must be a positive integer`);
  }
  if (o.status !== "draft" && o.status !== "reviewed")
    out.push(`${ns}: meta "${key}": status must be draft or reviewed`);
  if (o.screenshot !== undefined && typeof o.screenshot !== "string")
    out.push(`${ns}: meta "${key}": screenshot must be a string`);
  return out;
}

export function checkNamespace(
  ns: string,
  uz: unknown,
  ru: unknown,
  meta: Record<string, Partial<MetaEntry>> | undefined,
): string[] {
  const out: string[] = [...leafTypeProblems(ns, uz), ...leafTypeProblems(ns, ru)];
  const u = new Map(flattenMessages(uz));
  const r = new Map(flattenMessages(ru));
  for (const k of u.keys()) if (!r.has(k)) out.push(`${ns}: key "${k}" missing in ru`);
  for (const k of r.keys()) if (!u.has(k)) out.push(`${ns}: key "${k}" missing in uz`);
  for (const k of Object.keys(meta ?? {})) {
    if (!u.has(k) && !r.has(k)) out.push(`${ns}: meta entry "${k}" has no message in uz and ru`);
  }
  for (const [k, uzText] of u) {
    const ruText = r.get(k);
    const m = meta?.[k];
    if (!m) out.push(`${ns}: key "${k}" has no meta entry (context, maxLen, status)`);
    else out.push(...metaProblems(ns, k, m));
    const texts: [string, string | undefined][] = [
      ["uz", uzText],
      ["ru", ruText],
    ];
    let icuOk = true;
    for (const [lang, text] of texts) {
      if (text === undefined) continue;
      if (text.trim() === "") out.push(`${ns}: ${lang} "${k}" is empty`);
      const icu = checkIcuSyntax(text);
      if (icu) {
        icuOk = false;
        out.push(`${ns}: ${lang} "${k}" is not valid ICU: ${icu}`);
      }
      if (typeof m?.maxLen === "number" && text.length > m.maxLen) {
        out.push(`${ns}: ${lang} "${k}" is ${text.length} > maxLen ${m.maxLen}`);
      }
      if (/\$|\bUSD\b/.test(text)) out.push(`${ns}: ${lang} "${k}" mentions dollars; prices are in sums only`);
    }
    if (ruText !== undefined && icuOk && placeholderSignature(uzText).join() !== placeholderSignature(ruText).join()) {
      out.push(
        `${ns}: key "${k}" placeholders differ: uz {${placeholderSignature(uzText).join(", ")}} vs ru {${placeholderSignature(ruText).join(", ")}}`,
      );
    }
  }
  return out;
}
