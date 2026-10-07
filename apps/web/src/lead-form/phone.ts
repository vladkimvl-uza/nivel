// Phone numbers of the request form: the people write them in many ways, the lead needs E.164 (`+998901234567`).
// The same shape the database checks (`leads_contact_phone_chk`): a plus, a non-zero digit, 8 to 15 digits in all.

const SEPARATORS = /[\s().-]/g;
const E164 = /^\+[1-9][0-9]{7,14}$/;
/** After 998 comes an operator or area code (2-9) and seven more digits. */
const UZ_NATIONAL = /^[2-9][0-9]{8}$/;

/**
 * Normalizes what a visitor typed into E.164, or returns null. Uzbek numbers may come without the country code
 * (`90 123 45 67`, `8 90 123 45 67`); a foreign number has to start with a plus. Only ASCII digits count.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(SEPARATORS, "");
  if (text === "") return null;
  if (text.startsWith("+")) {
    if (!E164.test(text)) return null;
    // An Uzbek number has exactly nine digits after the code.
    if (text.startsWith("+998") && !UZ_NATIONAL.test(text.slice(4))) return null;
    return text;
  }
  if (!/^[0-9]+$/.test(text)) return null;
  if (text.startsWith("998") && text.length === 12 && UZ_NATIONAL.test(text.slice(3))) return `+${text}`;
  if (text.length === 9 && UZ_NATIONAL.test(text)) return `+998${text}`;
  if (text.length === 10 && text.startsWith("8") && UZ_NATIONAL.test(text.slice(1))) return `+998${text.slice(1)}`;
  return null;
}
