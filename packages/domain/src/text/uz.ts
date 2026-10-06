// Uzbek (Latin) text normalization. Re-exported by packages/i18n (ARCHITECTURE 4.12, block 26 section 7.2).
import type { UzTextApi } from "./types.ts";

const OKINA = "ʻ"; // U+02BB, the sign in oʻ and gʻ
const TUTUQ = "ʼ"; // U+02BC, tutuq belgisi (maʼlumot, sanʼat)

// Everything people type or autocorrect into an apostrophe: ' ‘ ’ ` ´ and the two modifier letters themselves.
const MARKS = "'‘’`´ʻʼ";

// One pass, so that a freshly written U+02BB is never rewritten as tutuq:
//  1. o, O, g, G followed by a mark: always oʻ / gʻ, also at the end of a word (togʻ, bogʻ);
//  2. any other Latin letter, a mark and a Latin letter after it: tutuq. Cyrillic text (д'Артаньян) is never touched.
// No lookbehind on purpose: this module also runs in the browser, and Safari before 16.4 rejects lookbehind.
const SIGNS = new RegExp(String.raw`([oOgG])[${MARKS}]|(\p{Script=Latin})[${MARKS}](?=\p{Script=Latin})`, "gu");
const ANY_MARK = new RegExp(`[${MARKS}]`, "gu");

function assertString(input: unknown, fn: string): asserts input is string {
  if (typeof input !== "string") throw new TypeError(`${fn}: expected a string, got ${typeof input}`);
}

/** oʻ, gʻ: ' ‘ ’ ` ʼ after o/O/g/G → U+02BB; other apostrophes between letters → U+02BC. */
export function normalizeUz(input: string): string {
  assertString(input, "normalizeUz");
  return input.replace(SIGNS, (_m, og?: string, letter?: string) =>
    og === undefined ? `${letter}${TUTUQ}` : `${og}${OKINA}`,
  );
}

/**
 * Search key: normalized, apostrophes folded away, lower case (locale independent), NFC, single spaces.
 * Folding away (not to one sign) lets input typed without ʻ on a phone find "oʻzbek" as well.
 */
export function uzSearchKey(input: string): string {
  assertString(input, "uzSearchKey");
  return normalizeUz(input.normalize("NFC"))
    .replace(ANY_MARK, "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}

export const uzTextApi = { normalizeUz, uzSearchKey } satisfies UzTextApi;
