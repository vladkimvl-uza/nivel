// POST /orders/upload: a photo of a kind the orders need and the base upload does not take yet: the signed paper act
// (`act_photo`, the only kind `acts.sign` accepts for a paper act) and the statement of a payer who is not the customer
// (`third_party_statement`). It runs the same cleaning as /files/upload (EXIF off, HEIC refused, sharp for turned JPEG)
// and registers the file the same way. WP-10 owns the list of kinds of /files/upload (kit/upload/save.ts); when it adds
// these two, this route can go and the pickers point to /files/upload again.
import { createHash } from "node:crypto";
import { guardAction, NOT_ALLOWED } from "../auth/next.ts";
import { isSameOriginRequest } from "../auth/origin.ts";
import { getRuntime } from "../auth/runtime.ts";
import { sanitizeImage } from "../kit/upload/image.ts";
import { boundaryOf, parseMultipart } from "../kit/upload/multipart.ts";
import { BUSY, MAX_UPLOAD_BYTES, takeUploadSlot } from "../kit/upload/save.ts";
import { readBody, timingFor } from "./upload-body.ts";

export const ORDER_UPLOAD_KINDS: Record<
  string,
  { retentionClass: "order_warranty_plus_3y" | "tax_5y"; containsPd: boolean }
> = {
  act_photo: { retentionClass: "order_warranty_plus_3y", containsPd: true },
  third_party_statement: { retentionClass: "tax_5y", containsPd: true },
};

const OVERHEAD = 64 * 1024;

const reply = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function handleOrderUpload(
  request: Request,
  options: { totalMs?: number; idleMs?: number } = {},
): Promise<Response> {
  if (!isSameOriginRequest(request.headers))
    return reply(403, { ok: false, message: "Запрос не из этой админки отклонён." });
  const user = await guardAction("upload.write", "orders.upload_attempt", "ops.files");
  if (!user) return reply(403, { ok: false, message: NOT_ALLOWED });
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared))
    return reply(411, { ok: false, message: "Не удалось определить размер файла." });
  if (Number(declared) > MAX_UPLOAD_BYTES + OVERHEAD) return reply(413, { ok: false, message: "Файл больше 12 МБ." });
  const boundary = boundaryOf(request.headers.get("content-type"));
  if (!boundary) return reply(400, { ok: false, message: "Не удалось прочитать форму." });

  const slot = await takeUploadSlot({ signal: request.signal });
  if (!slot) return reply(503, { ok: false, message: BUSY });
  try {
    const body = await readBody(request, Number(declared), timingFor(Number(declared), options));
    if (body === "slow") return reply(408, { ok: false, message: "Файл передаётся слишком медленно. Повторите." });
    const parts = body ? parseMultipart(body, boundary) : null;
    if (!parts) return reply(400, { ok: false, message: "Не удалось прочитать форму." });
    const file = parts.find((p) => p.name === "photo" && p.filename !== null);
    if (!file || file.data.length === 0) return reply(400, { ok: false, message: "Выберите или снимите фото." });
    if (file.data.length > MAX_UPLOAD_BYTES) return reply(413, { ok: false, message: "Файл больше 12 МБ." });
    const kindPart = parts.find((p) => p.name === "kind" && p.filename === null);
    const kind = kindPart && kindPart.data.length <= 64 ? kindPart.data.toString("utf8") : "";
    if (!Object.hasOwn(ORDER_UPLOAD_KINDS, kind)) return reply(400, { ok: false, message: "Неизвестный вид файла." });
    const spec = ORDER_UPLOAD_KINDS[kind] as (typeof ORDER_UPLOAD_KINDS)[string];

    const runtime = getRuntime();
    const clean = await sanitizeImage(file.data, runtime.upload.fallback ? { fallback: runtime.upload.fallback } : {});
    if (!clean.ok) return reply(400, { ok: false, message: clean.error });
    const sha256 = createHash("sha256").update(clean.data).digest("hex");
    const storageKey = `uploads/${sha256.slice(0, 2)}/${sha256}.${clean.ext}`;
    await runtime.upload.files.put(storageKey, clean.data);
    const row = await runtime.upload.registry.register({
      sha256,
      mime: clean.mime,
      bytes: clean.data.length,
      storageKey,
      kind,
      isPublic: false,
      containsPd: spec.containsPd,
      retentionClass: spec.retentionClass,
      createdBy: `admin:${user.id}`,
    });
    if (row.duplicate) {
      // One picture is one file (its key is the hash). The same picture under another kind is not what the person means to
      // attach: the signature of an act needs a file registered as the photo of an act.
      const { rows } = await runtime.db.$client.query<{ kind: string }>("select kind from ops.files where id = $1", [
        row.id,
      ]);
      if (rows[0] && rows[0].kind !== kind) {
        return reply(409, {
          ok: false,
          message: "Этот снимок уже загружен для другого документа. Сделайте новый снимок нужного документа.",
        });
      }
    }
    await runtime.audit.append({
      actor: `admin:${user.id}`,
      action: "files.upload",
      entity: "ops.files",
      entityId: row.id,
      after: {
        kind,
        sha256,
        bytes: clean.data.length,
        mime: clean.mime,
        removed: clean.removed,
        duplicate: row.duplicate,
      },
    });
    return reply(200, {
      ok: true,
      message: row.duplicate
        ? "Такой файл уже загружен: новая копия не создана."
        : "Файл сохранён. Координаты и данные съёмки из него удалены.",
      file: { id: row.id, storageKey, bytes: clean.data.length, removed: clean.removed, duplicate: row.duplicate },
    });
  } finally {
    slot.release();
  }
}
