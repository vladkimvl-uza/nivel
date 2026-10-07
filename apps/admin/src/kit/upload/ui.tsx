"use client";

// The upload form for a phone: the camera of the phone opens straight from the field (`capture="environment"`), the
// picture goes by fetch to POST /files/upload (a route handler: a server action would stop at 1 MB, a phone photo
// weighs more), which strips what the camera wrote into it.
import { Button } from "@nivel/ui/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { UploadState } from "./handler.ts";

const MAX_BYTES = 12 * 1024 * 1024;
const UPLOAD_URL = "/files/upload";

async function send(data: FormData): Promise<UploadState> {
  try {
    const response = await fetch(UPLOAD_URL, { method: "POST", body: data, credentials: "same-origin" });
    const state = (await response.json().catch(() => null)) as UploadState | null;
    if (state && typeof state.message === "string") return state;
    return { ok: false, message: `Не удалось загрузить файл (ответ ${response.status}). Попробуйте ещё раз.` };
  } catch {
    return { ok: false, message: "Нет связи с сервером. Проверьте сеть и повторите." };
  }
}

export function PhotoUploadForm({ kinds }: { kinds: { value: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const photo = data.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      setState({ ok: false, message: "Выберите или снимите фото." });
      return;
    }
    if (photo.size > MAX_BYTES) {
      setState({ ok: false, message: "Файл больше 12 МБ." });
      return;
    }
    setPending(true);
    setState({});
    const result = await send(data);
    setPending(false);
    setState(result);
    if (result.ok) {
      form.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="adm-form" data-testid="upload-form" encType="multipart/form-data">
      {state.message ? (
        <p
          className={state.ok ? "adm-flash adm-flash--ok" : "adm-flash adm-flash--error"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
      {state.file ? (
        <p className="adm-note" data-testid="upload-result">
          {state.file.id} · {state.file.bytes} байт · убрано:{" "}
          {state.file.removed.join(", ") || "ничего лишнего не было"}
        </p>
      ) : null}
      <div className="nv-field">
        <label className="nv-field__label" htmlFor="upload-kind">
          Что это
        </label>
        <span className="nv-select">
          <select className="nv-field__control" id="upload-kind" name="kind" defaultValue={kinds[0]?.value}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor="upload-photo">
          Фото
        </label>
        <input
          className="nv-field__control"
          id="upload-photo"
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          style={{ paddingTop: 10 }}
        />
        <p className="nv-field__hint">JPEG, PNG или WebP до 12 МБ. Геопозиция и данные камеры из файла удаляются.</p>
      </div>
      <div className="adm-actions">
        <Button type="submit" disabled={pending} mark>
          {pending ? "Загружаю…" : "Загрузить"}
        </Button>
      </div>
    </form>
  );
}
