// POST /api/internal/revalidate (ARCHITECTURE 5.1, 10.1 A08): the admin panel and the worker tell the site which cache tags
// to drop. The request is signed: header `x-nivel-signature` is the hex HMAC-SHA256 of "<timestamp>.<body>" under
// REVALIDATE_HMAC_KEY, header `x-nivel-timestamp` is the time of the request in milliseconds. The senders are
// apps/admin/src/kit/settings/service.ts and apps/worker/src/jobs/outbox/revalidate.ts; this is the other end.
import { createHmac, timingSafeEqual } from "node:crypto";

/** How old (or how far ahead) a request may be: five minutes. */
export const REVALIDATE_MAX_AGE_MS = 5 * 60_000;
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_TAGS = 20;
/** The same shape the worker validates before it sends. */
const TAG = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Shorter keys are a misconfiguration (packages/config asks for 32): the door stays shut. */
const MIN_KEY_LENGTH = 32;

export function signRevalidate(key: string, timestampMs: number | string, body: string): string {
  return createHmac("sha256", key).update(`${timestampMs}.${body}`).digest("hex");
}

export type RevalidateVerdict = "ok" | "stale" | "bad_signature" | "bad_timestamp";

/** The timestamp, then the signature (compared in constant time), then the age: a stranger learns nothing from the order. */
export function verifyRevalidate(i: {
  key: string;
  timestamp: string;
  body: string;
  signature: string;
  now: number;
}): RevalidateVerdict {
  if (!/^[0-9]{1,16}$/.test(i.timestamp)) return "bad_timestamp";
  const expected = Buffer.from(signRevalidate(i.key, i.timestamp, i.body), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/i.test(i.signature) ? i.signature : "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad_signature";
  return Math.abs(i.now - Number(i.timestamp)) > REVALIDATE_MAX_AGE_MS ? "stale" : "ok";
}

export interface RevalidateDeps {
  /** REVALIDATE_HMAC_KEY; without it every request is refused with 503. */
  key: string | undefined;
  now(): number;
  /** Drops one tag of the cache of the site (`revalidateTag(tag, "max")` in the route). */
  revalidate(tag: string): void;
}

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Reads at most `max` bytes of the body; null when there is more. */
async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseTags(text: string): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const tags = data !== null && typeof data === "object" ? (data as { tags?: unknown }).tags : undefined;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_TAGS) return null;
  if (tags.some((t) => typeof t !== "string" || !TAG.test(t))) return null;
  return [...new Set(tags as string[])];
}

export async function handleRevalidate(request: Request, deps: RevalidateDeps): Promise<Response> {
  if (!deps.key || deps.key.length < MIN_KEY_LENGTH) return json(503, { ok: false, error: "not_configured" });
  const body = await readLimited(request, MAX_BODY_BYTES);
  if (body === null) return json(413, { ok: false, error: "too_large" });
  const verdict = verifyRevalidate({
    key: deps.key,
    timestamp: request.headers.get("x-nivel-timestamp") ?? "",
    signature: request.headers.get("x-nivel-signature") ?? "",
    body,
    now: deps.now(),
  });
  if (verdict !== "ok") return json(401, { ok: false, error: verdict });
  const tags = parseTags(body);
  if (!tags) return json(400, { ok: false, error: "bad_body" });
  try {
    for (const tag of tags) deps.revalidate(tag);
  } catch {
    return json(500, { ok: false, error: "failed" });
  }
  return json(200, { ok: true, tags });
}
