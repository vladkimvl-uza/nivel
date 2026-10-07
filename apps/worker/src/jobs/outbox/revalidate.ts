// web.revalidate: the admin panel (and any scenario that changes what the site shows from its cache) queues { tags } when its own
// request to the site did not get through; the worker repeats it. The request is POST /api/internal/revalidate of the site (WP-16)
// signed the way the admin panel signs it (apps/admin/src/kit/settings/service.ts): `x-nivel-timestamp` is the time of the
// request in milliseconds and `x-nivel-signature` is the hex HMAC-SHA256 of "<timestamp>.<body>" under REVALIDATE_HMAC_KEY.
// The site refuses a request older than five minutes, so every attempt is signed again at the moment it is made.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "pino";
import { PermanentJobError } from "../../queues/define.ts";
import { sanitizeMessage } from "../../queues/failures.ts";

export const REVALIDATE_PATH = "/api/internal/revalidate";
/** How old (or how far ahead) a request may be for the site to take it. */
export const REVALIDATE_MAX_AGE_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;
const TAG = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_TAGS = 20;

export function signRevalidate(key: string, timestampMs: number | string, body: string): string {
  return createHmac("sha256", key).update(`${timestampMs}.${body}`).digest("hex");
}

export type RevalidateVerdict = "ok" | "stale" | "bad_signature" | "bad_timestamp";

/** What the site does with a request (the reference for WP-16, and the check of this job's own signature in the tests). */
export function verifyRevalidate(i: {
  key: string;
  timestamp: string;
  body: string;
  signature: string;
  now: number;
}): RevalidateVerdict {
  if (!/^\d{1,16}$/.test(i.timestamp)) return "bad_timestamp";
  const expected = Buffer.from(signRevalidate(i.key, i.timestamp, i.body), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/i.test(i.signature) ? i.signature : "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad_signature";
  return Math.abs(i.now - Number(i.timestamp)) > REVALIDATE_MAX_AGE_MS ? "stale" : "ok";
}

export interface RevalidateDeps {
  fetch: typeof fetch;
  now(): Date;
  log: Logger;
  settings: { publicBaseUrl: string; revalidateKey: string };
  timeoutMs?: number;
}

/** Answers that mean the same request will be refused again; the others (the site is down, deploying, busy) are retried. */
const REFUSED_FOR_GOOD = new Set([400, 401, 403, 422]);

export async function handleRevalidate(deps: RevalidateDeps, data: Record<string, unknown>): Promise<void> {
  const tags = data.tags;
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > MAX_TAGS ||
    tags.some((t) => typeof t !== "string" || !TAG.test(t))
  ) {
    throw new PermanentJobError(`web.revalidate: tags must be 1 to ${MAX_TAGS} names of letters, digits and _.:-`);
  }
  const body = JSON.stringify({ tags });
  const timestamp = String(deps.now().getTime());
  const url = new URL(REVALIDATE_PATH, deps.settings.publicBaseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  let status: number;
  try {
    const response = await deps.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nivel-timestamp": timestamp,
        "x-nivel-signature": signRevalidate(deps.settings.revalidateKey, timestamp, body),
      },
      body,
      signal: controller.signal,
    });
    status = response.status;
  } catch (error) {
    // The text of a network error is cleaned of the key before it goes anywhere.
    const aborted = error instanceof Error && error.name === "AbortError";
    const text = aborted ? "timeout" : sanitizeMessage(error).replaceAll(deps.settings.revalidateKey, "<key>");
    throw new Error(`web.revalidate: the site did not answer (${text})`);
  } finally {
    clearTimeout(timer);
  }
  if (status >= 200 && status < 300) {
    deps.log.info({ tags }, "web.revalidate: the site took the tags");
    return;
  }
  if (REFUSED_FOR_GOOD.has(status)) {
    throw new PermanentJobError(`web.revalidate: the site refused the request with HTTP ${status}`);
  }
  throw new Error(`web.revalidate: the site answered HTTP ${status}`);
}
