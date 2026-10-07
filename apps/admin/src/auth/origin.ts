// A route handler (unlike a server action of Next.js) is not checked for the origin of the request. The session cookie
// is SameSite=Strict, which already keeps a foreign site from sending it; this check is the second line: the request
// must come from a page of this admin (ARCHITECTURE 10.1 A01).

/** `Origin` of the request names the host it was sent to; `Sec-Fetch-Site`, when the browser sends it, is same-origin. */
export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (!host) return false;
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return host === forwarded || host === headers.get("host");
}
