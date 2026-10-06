// POST /files/upload: a photo from the phone to the folder of files.
//
// A route handler and not a server action: Next.js stops the body of a server action at 1 MB (`bodySizeLimit`, 413
// before the action is called), and a picture from a phone camera weighs 2-8 MB. A route handler has no such limit,
// so the limit of this file (12 MB) is checked here, from the declared length, before the body is read.
import { revalidatePath } from "next/cache";
import { guardAction, NOT_ALLOWED } from "../../auth/next.ts";
import { isSameOriginRequest } from "../../auth/origin.ts";
import { getRuntime } from "../../auth/runtime.ts";
import { MAX_UPLOAD_BYTES, saveUpload } from "./save.ts";

export const UPLOAD_PATH = "/files/upload";

/** What the multipart wrapping (boundaries, field names, the kind) may add to the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

export interface UploadState {
  ok?: boolean;
  message?: string;
  file?: { id: string; storageKey: string; bytes: number; removed: string[]; duplicate: boolean };
}

const reply = (status: number, state: UploadState): Response =>
  new Response(JSON.stringify(state), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const TOO_BIG = "Файл больше 12 МБ.";

export async function handleUploadRequest(request: Request): Promise<Response> {
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

  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return reply(400, { ok: false, message: "Не удалось прочитать форму." });
  }
  const file = data.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return reply(400, { ok: false, message: "Выберите или снимите фото." });
  }
  if (file.size > MAX_UPLOAD_BYTES) return reply(413, { ok: false, message: TOO_BIG });
  const kind = data.get("kind");
  const result = await saveUpload(getRuntime().upload, {
    actor: user,
    bytes: Buffer.from(await file.arrayBuffer()),
    kind: typeof kind === "string" ? kind : "",
  });
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
