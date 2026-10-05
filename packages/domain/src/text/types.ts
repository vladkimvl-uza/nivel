// Frozen contract (ARCHITECTURE 4.12). Change only via ADR and a "contract" PR.

export interface UzTextApi {
  /** oʻ, gʻ: ' ‘ ’ ` ʼ after o/O/g/G → U+02BB; other apostrophes between letters → U+02BC (block 26, 7.2). */
  normalizeUz(input: string): string;
  /** Search key: normalized, lowercased, apostrophes folded: "o'yin" finds "oʻyin". */
  uzSearchKey(input: string): string;
}
