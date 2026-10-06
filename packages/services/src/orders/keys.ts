// Identity of an event: the same event sent twice (a double click, a retry of the bot after a lost answer) must be
// recognised, so that it neither doubles the journal nor the outbox (BUILD_PLAN WP-07, acceptance).
import { createHash } from "node:crypto";

/** JSON with the keys sorted at every level; dates as ISO text, undefined dropped, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value ?? null))));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/**
 * The part of an event that says what happened. The amounts of a cancellation are computed by the server, so they are
 * not part of the identity; the point, the reason and the owner inputs are.
 */
export function eventIdentity(event: Record<string, unknown>): Record<string, unknown> {
  if (event.type !== "CANCEL") return event;
  const { settlement: _settlement, ...rest } = event;
  return rest;
}

export function eventDigest(event: unknown): string {
  return createHash("sha256").update(canonicalJson(event), "utf8").digest("hex");
}
