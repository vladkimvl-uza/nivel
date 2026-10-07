// Ids the worker makes or checks. A job of pg-boss has an id of its own (a UUID, the primary key with the name of the queue), and
// sending a job under an id that exists is a quiet no-op: that, and not `singletonKey` (which only works under some queue
// policies), is what keeps one job for one fact.
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A UUID (version 5 layout) made from a key: the same key, the same id. */
export function jobIdOf(key: string): string {
  const h = createHash("sha1").update(`nivel-worker-job\n${key}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
