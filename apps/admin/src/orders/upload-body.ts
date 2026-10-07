// The body of an upload request as one buffer, with the guards of /files/upload (kit/upload/handler.ts, where the
// reasons are written down: a body that comes in pieces of one byte took 430 MB in a container of 384 MB). WP-10 does not
// export its reader, so the route of the orders keeps this one; when the two kinds move into the base upload this file
// goes with the route. The limits are the base ones: they are imported, not repeated.
import { bodyDeadlineMs, MAX_BODY_CHUNKS } from "../kit/upload/handler.ts";

/** A client that sends nothing for this long has stopped: its place is given to the next. */
export const BODY_IDLE_MS = 15_000;

export interface BodyTiming {
  totalMs: number;
  idleMs: number;
}

export const timingFor = (declaredBytes: number, options: Partial<BodyTiming> = {}): BodyTiming => ({
  totalMs: options.totalMs ?? bodyDeadlineMs(declaredBytes),
  idleMs: options.idleMs ?? BODY_IDLE_MS,
});

/**
 * The body as one buffer; `"slow"` when it does not arrive in time, stops, comes in too many pieces or the client
 * leaves, null when it cannot be read (or is longer than it declared). The buffer is made once, of the declared length:
 * what the body costs does not depend on the number of its pieces.
 */
export async function readBody(
  request: Request,
  declared: number,
  timing: BodyTiming,
): Promise<Buffer | "slow" | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const body = Buffer.allocUnsafe(declared);
  let total = 0;
  let pieces = 0;
  const state = { stopped: false };
  const started = Date.now();
  let lastAt = started;
  const stop = () => {
    state.stopped = true;
    void reader.cancel().catch(() => {});
  };
  // One timer for the whole body (not one per piece): it also watches for a client that has stopped.
  const watch = setInterval(
    () => {
      const t = Date.now();
      if (t - started >= timing.totalMs || t - lastAt >= timing.idleMs) stop();
    },
    Math.max(10, Math.min(1000, Math.floor(Math.min(timing.totalMs, timing.idleMs) / 4))),
  );
  request.signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      const step = await reader.read();
      if (state.stopped) return "slow";
      if (step.done) break;
      pieces += 1;
      if (pieces > MAX_BODY_CHUNKS) {
        await reader.cancel().catch(() => {});
        return "slow";
      }
      const piece = step.value;
      if (total + piece.length > declared) {
        await reader.cancel().catch(() => {});
        return null;
      }
      body.set(piece, total);
      total += piece.length;
      lastAt = Date.now();
    }
  } catch {
    return state.stopped ? "slow" : null;
  } finally {
    clearInterval(watch);
    request.signal.removeEventListener("abort", stop);
  }
  return body.subarray(0, total);
}
