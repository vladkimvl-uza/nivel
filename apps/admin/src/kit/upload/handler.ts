// POST /files/upload: a photo from the phone to the folder of files.
//
// A route handler and not a server action: Next.js stops the body of a server action at 1 MB (`bodySizeLimit`, 413
// before the action is called), and a picture from a phone camera weighs 2-8 MB. A route handler has no such limit,
// so the limit of this file (12 MB) is checked here, from the declared length, before the body is read.
//
// Memory is what is guarded (384 MB in the container): the place among the uploads is taken before the first byte of
// the body is read; the body is read with a limit and a time (not trusting the declared length); the parts of the form
// are counted before they are built (multipart.ts); the parts are slices of the one buffer.
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
/** A phone on a bad connection sends 12 MB in well under a minute; a client that is slower than this holds a place for nothing. */
const BODY_TIMEOUT_MS = 60_000;

/** The body as one buffer; `"too_big"` past the limit (whatever was declared), `"slow"` when it does not arrive in time. */
async function readBody(
  request: Request,
  limit: number,
  timeoutMs: number,
): Promise<Buffer | "too_big" | "slow" | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), timeoutMs);
  });
  try {
    for (;;) {
      const step = await Promise.race([reader.read(), late]);
      if (step === "slow") {
        await reader.cancel().catch(() => {});
        return "slow";
      }
      if (step.done) break;
      total += step.value.length;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return "too_big";
      }
      chunks.push(step.value);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks, total);
}

export async function handleUploadRequest(
  request: Request,
  options: { bodyTimeoutMs?: number } = {},
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
  const slot = await takeUploadSlot();
  if (!slot) return reply(503, { ok: false, message: BUSY }, { "retry-after": "60" });
  try {
    const body = await readBody(
      request,
      MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD,
      options.bodyTimeoutMs ?? BODY_TIMEOUT_MS,
    );
    if (body === "too_big") return reply(413, { ok: false, message: TOO_BIG });
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
