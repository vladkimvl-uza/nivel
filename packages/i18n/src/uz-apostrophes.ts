// Uzbek apostrophes (ARCHITECTURE 5.2, block 26 7.1): oʻ and gʻ carry U+02BB, tutuq and every other apostrophe between
// letters is U+02BC. U+0027, U+2018, U+2019 and U+0060 inside a word are wrong.

const WRONG = { "'": "U+0027", "’": "U+2019", "‘": "U+2018", "`": "U+0060" } as const;
type WrongMark = keyof typeof WRONG;

const WORD = /[\p{L}'’‘`ʻʼ]+/gu;
const WRONG_INSIDE = /(?<=\p{L})['’‘`](?=\p{L})/u;
const TUTUQ_AFTER_O_G = /(?<=[oOgG])ʼ(?=\p{L})/u;
const OKINA_AFTER_OTHER = /(?<=(?![oOgG])\p{L})ʻ(?=\p{L})/u;
const MARK_INSIDE = /(?<=(\p{L}))['’‘`ʻʼ](?=\p{L})/gu;

/** Fixes every apostrophe between letters of a word: U+02BB after o/g, U+02BC after other letters. */
export function suggestUz(word: string): string {
  return word.replace(MARK_INSIDE, (_m, prev: string) => ("oOgG".includes(prev) ? "ʻ" : "ʼ"));
}

/** Problems of one Uzbek string; `where` labels them (file and key). */
export function checkUzString(where: string, value: string): string[] {
  const out: string[] = [];
  for (const [word] of value.matchAll(WORD)) {
    const wrong = WRONG_INSIDE.exec(word);
    let reason: string | null = null;
    if (wrong) reason = `has ${WRONG[wrong[0] as WrongMark]} inside a word`;
    else if (TUTUQ_AFTER_O_G.test(word)) reason = "has U+02BC after o/g";
    else if (OKINA_AFTER_OTHER.test(word)) reason = "has U+02BB after a letter other than o/g";
    if (reason) out.push(`${where}: "${word}" ${reason}; use "${suggestUz(word)}"`);
  }
  return out;
}
