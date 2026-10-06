"use server";

// The server action of the upload screen: a photo from the phone to the folder of files.
import { revalidatePath } from "next/cache";
import { guardAction, NOT_ALLOWED } from "../../auth/next.ts";
import { getRuntime } from "../../auth/runtime.ts";
import { MAX_UPLOAD_BYTES, saveUpload } from "./save.ts";

export interface UploadState {
  ok?: boolean;
  message?: string;
  file?: { id: string; storageKey: string; bytes: number; removed: string[]; duplicate: boolean };
}

export async function uploadAction(_previous: UploadState, data: FormData): Promise<UploadState> {
  const user = await guardAction("upload.write", "files.upload_attempt", "ops.files");
  if (!user) return { ok: false, message: NOT_ALLOWED };
  const file = data.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Выберите или снимите фото." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "Файл больше 12 МБ." };
  const kind = typeof data.get("kind") === "string" ? String(data.get("kind")) : "";
  const result = await saveUpload(getRuntime().upload, {
    actor: user,
    bytes: Buffer.from(await file.arrayBuffer()),
    kind,
  });
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/files");
  return {
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
  };
}
