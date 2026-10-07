// POST /files/upload: a photo from the phone to the folder of files.
//
// A route handler and not a server action: Next.js stops the body of a server action at 1 MB (`bodySizeLimit`, 413
// before the action is called), and a picture from a phone camera weighs 2-8 MB. A route handler has no such limit,
// so the limit of this file (12 MB) is checked here, from the declared length, before the body is read.
//
// Memory is what is guarded (384 MB in the container): the place among the uploads is taken before the first byte of
// the body is read; the body is read into one buffer of the declared length, with a time that follows the length, a
// bound on the pieces and a stop when the client leaves; the parts of the form are counted before they are built
// (multipart.ts); the parts are slices of the one buffer.
import { revalidatePath } from "next/cache";
import { guardAction, NOT_ALLOWED } from "../../auth/next.ts";
import { isSameOriginRequest } from "../../auth/origin.ts";
import { getRuntime } from "../../auth/runtime.ts";
import { boundaryOf, parseMultipart } from "./multipart.ts";
import { BUSY, MAX_UPLOAD_BYTES, saveUpload, takeUploadSlot } from "./save.ts";

export const UPLOAD_PATH = "/files/upload";

/** What the multipart wrapping (boundaries, field names, the kind) may add to the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

export interface UploadState {
  ok?: boolean;
  message?: string;
  file?: { id: string; storageKey: string; bytes: number; removed: string[]; duplicate: boolean };
}

const reply = (status: number, state: UploadState, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(state), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

const TOO_BIG = "Файл больше 12 МБ.";
const NOT_A_FORM = "Не удалось прочитать форму.";
/**
 * Time for the body (a place among the uploads is held all that time): a grace for the connection to come up, then a
 * modest speed of 100 KB/s (a phone on a poor mobile network has that), and never above two minutes. A small file gets
 * little time, a file of 12 MB gets all of it.
 */
export const BODY_GRACE_MS = 10_000;
export const BODY_MIN_BYTES_PER_SECOND = 100 * 1024;
export const BODY_TIMEOUT_MAX_MS = 120_000;
/** A client that sends nothing for this long has stopped: its place is given to the next. */
const BODY_IDLE_MS = 15_000;
/**
 * The pieces in which the body may come. A plain connection gives pieces of kilobytes (12 MB is a few thousand of them);
 * a client that sends one byte at a time is not sending a photo. Each piece costs a turn of the event loop even when
 * nothing is kept, and nothing that is slow in this way is worth a place.
 */
export const MAX_BODY_CHUNKS = 100_000;

export const bodyDeadlineMs = (declaredBytes: number): number =>
  Math.min(BODY_TIMEOUT_MAX_MS, BODY_GRACE_MS + Math.ceil((declaredBytes / BODY_MIN_BYTES_PER_SECOND) * 1000));

interface BodyTiming {
  totalMs: number;
  idleMs: number;
}

/**
 * The body as one buffer; `"slow"` when it does not arrive in time, stops, comes in too many pieces or the client
 * leaves, null when it cannot be read (or is longer than it declared).
 *
 * The buffer is made once, of the declared length (checked against the limit by the caller), and every piece is copied
 * into it and let go: what the body costs does not depend on the number of the pieces. (Keeping each piece as an object
 * of its own took 430 MB for half a megabyte sent by single bytes.) A body longer than declared is not a form this
 * admin made: it is cut there.
 */
async function readBody(request: Request, declared: number, timing: BodyTiming): Promise<Buffer | "slow" | null> {
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

export async function handleUploadRequest(
  request: Request,
  options: { bodyTimeoutMs?: number; idleTimeoutMs?: number } = {},
): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) {
    return reply(403, { ok: false, message: "Запрос не из этой админки отклонён." });
  }
  const user = await guardAction("upload.write", "files.upload_attempt", "ops.files");
  if (!user) return reply(403, { ok: false, message: NOT_ALLOWED });

  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) {
    return reply(411, { ok: false, message: "Не удалось определить размер файла." });
  }
  if (Number(declared) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) return reply(413, { ok: false, message: TOO_BIG });

  const boundary = boundaryOf(request.headers.get("content-type"));
  if (!boundary) return reply(400, { ok: false, message: NOT_A_FORM });

  // The place first, the body after: a request that has to wait, or is turned away, has taken no memory for its body.
  // A waiter leaves the queue when the client leaves (request.signal), and does not wait without end.
  const slot = await takeUploadSlot({ signal: request.signal });
  if (!slot) return reply(503, { ok: false, message: BUSY }, { "retry-after": "60" });
  try {
    const body = await readBody(request, Number(declared), {
      totalMs: options.bodyTimeoutMs ?? bodyDeadlineMs(Number(declared)),
      idleMs: options.idleTimeoutMs ?? BODY_IDLE_MS,
    });
    if (body === "slow") return reply(408, { ok: false, message: "Файл передаётся слишком медленно. Повторите." });
    const parts = body ? parseMultipart(body, boundary) : null;
    if (!parts) return reply(400, { ok: false, message: NOT_A_FORM });
    const file = parts.find((p) => p.name === "photo" && p.filename !== null);
    if (!file || file.data.length === 0) {
      return reply(400, { ok: false, message: "Выберите или снимите фото." });
    }
    if (file.data.length > MAX_UPLOAD_BYTES) return reply(413, { ok: false, message: TOO_BIG });
    const kind = parts.find((p) => p.name === "kind" && p.filename === null);
    const result = await saveUpload(getRuntime().upload, {
      actor: user,
      bytes: file.data,
      kind: kind && kind.data.length <= 64 ? kind.data.toString("utf8") : "",
      slot,
    });
    return finish(result);
  } finally {
    slot.release();
  }
}

type SaveResult = Awaited<ReturnType<typeof saveUpload>>;

function finish(result: SaveResult): Response {
  if (!result.ok) return reply(400, { ok: false, message: result.error });
  revalidatePath("/files");
  return reply(200, {
    ok: true,
    message: result.duplicate
      ? "Такой файл уже загружен: новая копия не создана."
      : "Файл сохранён. Координаты и данные съёмки из него удалены.",
    file: {
      id: result.id,
      storageKey: result.storageKey,
      bytes: result.bytes,
      removed: result.removed,
      duplicate: result.duplicate,
    },
  });
}
