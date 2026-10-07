// Campaign marks of the address of the page (`?utm_source=instagram`): they travel with the request, so that the owner sees
// where a customer came from. Only the five standard keys, only short values; the server reads them again (form.ts).

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const MAX_VALUE = 200;

export function pickUtm(search: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const raw = search[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && value.length <= MAX_VALUE) out[key] = value;
  }
  return out;
}
