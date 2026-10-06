// Glossary of 116 PC and setup terms (research block 26, section 6): the seed of content.glossary and a check for
// translations. Terms are data (packages/db/seed/glossary/glossary.json); this module reads and applies them.
import { checkUzString } from "./uz-apostrophes.ts";

export const GLOSSARY_GROUPS = ["pc", "specs", "peripherals", "workplace", "service", "money"] as const;
export type GlossaryGroup = (typeof GLOSSARY_GROUPS)[number];

export interface GlossaryTerm {
  /** Row number in the research table, 1..116. */
  no: number;
  group: GlossaryGroup;
  termRu: string;
  termUz: string;
  /** Spelling in the new Latin alphabet; null when it does not change. */
  termUzNewLatin: string | null;
  note: string | null;
}

export const GLOSSARY_SIZE = 116;

function fail(path: string, expected: string): never {
  throw new TypeError(`glossary ${path}: expected ${expected}`);
}

/** Validates the shape of the seed file and returns typed terms. */
export function parseGlossary(data: unknown): GlossaryTerm[] {
  if (!Array.isArray(data)) fail("root", "an array");
  return data.map((raw: unknown, i) => {
    if (!raw || typeof raw !== "object") fail(`[${i}]`, "an object");
    const o = raw as Record<string, unknown>;
    if (typeof o.no !== "number" || !Number.isInteger(o.no)) fail(`[${i}].no`, "an integer");
    if (!GLOSSARY_GROUPS.includes(o.group as GlossaryGroup))
      fail(`[${i}].group`, `one of ${GLOSSARY_GROUPS.join(", ")}`);
    if (typeof o.termRu !== "string") fail(`[${i}].termRu`, "a string");
    if (typeof o.termUz !== "string") fail(`[${i}].termUz`, "a string");
    if (o.termUzNewLatin !== null && typeof o.termUzNewLatin !== "string")
      fail(`[${i}].termUzNewLatin`, "a string or null");
    if (o.note !== null && typeof o.note !== "string") fail(`[${i}].note`, "a string or null");
    return {
      no: o.no,
      group: o.group as GlossaryGroup,
      termRu: o.termRu,
      termUz: o.termUz,
      termUzNewLatin: o.termUzNewLatin,
      note: o.note,
    };
  });
}

/** Problems of the seed itself: count, numbering, empty fields, apostrophes. */
export function validateGlossary(terms: readonly GlossaryTerm[]): string[] {
  const out: string[] = [];
  if (terms.length !== GLOSSARY_SIZE) out.push(`glossary has ${terms.length} terms, expected ${GLOSSARY_SIZE}`);
  const numbers = terms.map((t) => t.no);
  if (numbers.some((n, i) => n !== i + 1)) out.push("glossary term numbers must be 1..N without gaps or repeats");
  for (const t of terms) {
    if (t.termRu.trim() === "") out.push(`glossary #${t.no}: termRu is empty`);
    if (t.termUz.trim() === "") out.push(`glossary #${t.no}: termUz is empty`);
    out.push(...checkUzString(`glossary #${t.no} termUz`, t.termUz));
  }
  return out;
}

export interface ForbiddenVariant {
  pattern: RegExp;
  /** What to write instead. */
  use: string;
}

/** Variants the glossary rules out (block 26: one term per notion; address is "Siz"). */
export const FORBIDDEN_UZ_VARIANTS: readonly ForbiddenVariant[] = [
  { pattern: /tezkor xotira/i, use: "operativ xotira" },
  { pattern: /(?<!uzluksiz\s)quvvat manbai/i, use: "quvvat bloki" },
  { pattern: /\b(?:sen|senga|seni|sening|senda|sendan)\b/i, use: "Siz" },
];

const GLOSSARY_NEEDLES = new WeakMap<readonly GlossaryTerm[], PreparedTerm[]>();

interface PreparedTerm {
  term: GlossaryTerm;
  /** Word stems of the Russian term, every one must occur at a word start. */
  stems: string[][];
  uzNeedle: string;
}

const foldUz = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’‘`ʻʼ]/g, "'");
const stripParens = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();

function ruStems(alternative: string): string[] {
  return stripParens(alternative)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length >= 5 ? w.slice(0, -2) : w));
}

function prepare(glossary: readonly GlossaryTerm[]): PreparedTerm[] {
  const cached = GLOSSARY_NEEDLES.get(glossary);
  if (cached) return cached;
  const prepared = glossary.map((term) => ({
    term,
    stems: term.termRu
      .split(",")
      .map(ruStems)
      .filter((stems) => stems.join("").length >= 4),
    uzNeedle: foldUz(stripParens(term.termUz)),
  }));
  GLOSSARY_NEEDLES.set(glossary, prepared);
  return prepared;
}

function hasStems(ruLower: string, stems: string[]): boolean {
  return stems.every((stem) => {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<!\\p{L})${escaped}`, "u").test(ruLower);
  });
}

/**
 * Glossary check of a translation. Errors: a forbidden variant in the Uzbek text. Warnings: the Russian text uses a
 * glossary term and the Uzbek text lacks its Uzbek counterpart (inflections are matched loosely, so this stays advice).
 */
export function glossaryProblems(
  ruText: string,
  uzText: string,
  glossary: readonly GlossaryTerm[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const v of FORBIDDEN_UZ_VARIANTS) {
    const m = v.pattern.exec(uzText);
    if (m) errors.push(`uz uses "${m[0].toLowerCase()}"; glossary term is "${v.use}"`);
  }
  const ruLower = ruText.toLowerCase();
  const uzFolded = foldUz(uzText);
  if (ruLower.trim() === "") return { errors, warnings };
  for (const { term, stems, uzNeedle } of prepare(glossary)) {
    if (!stems.some((s) => hasStems(ruLower, s))) continue;
    if (!uzFolded.includes(uzNeedle)) {
      warnings.push(
        `ru has "${stripParens(term.termRu.split(",")[0] ?? term.termRu).toLowerCase()}" but uz lacks "${stripParens(term.termUz)}" (glossary #${term.no})`,
      );
    }
  }
  return { errors, warnings };
}
