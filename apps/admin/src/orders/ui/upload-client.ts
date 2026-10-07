// The browser side of the photo upload of the orders screens, apart from React so that it can be tested: the size check
// and the request. The answer of the server is shown as it is (it is already Russian).
export const MAX_BYTES = 12 * 1024 * 1024;

export interface UploadAnswer {
  ok?: boolean;
  message?: string;
  file?: { id: string };
}

/** What is wrong with a picked file before it is sent, in Russian, or null. */
export function refuseBeforeSending(file: { size: number }): string | null {
  if (file.size === 0) return "Файл пустой.";
  if (file.size > MAX_BYTES) return "Файл больше 12 МБ.";
  return null;
}

export async function sendPhoto(
  endpoint: string,
  file: Blob,
  kind: string,
  doFetch: typeof fetch = fetch,
): Promise<UploadAnswer> {
  const data = new FormData();
  data.set("kind", kind);
  data.set("photo", file);
  try {
    const response = await doFetch(endpoint, { method: "POST", body: data, credentials: "same-origin" });
    const body = (await response.json().catch(() => null)) as UploadAnswer | null;
    if (body && typeof body.message === "string") return body;
    return { ok: false, message: `Не удалось загрузить файл (ответ ${response.status}). Попробуйте ещё раз.` };
  } catch {
    return { ok: false, message: "Нет связи с сервером. Проверьте сеть и повторите." };
  }
}
