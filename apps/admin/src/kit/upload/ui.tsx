"use client";

// The upload form for a phone: the camera of the phone opens straight from the field (`capture="environment"`), the
// picture goes to the server action, which strips what the camera wrote into it.
import { Button } from "@nivel/ui/react";
import { useActionState } from "react";
import { type UploadState, uploadAction } from "./actions.ts";

export function PhotoUploadForm({ kinds }: { kinds: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadAction, {});
  return (
    <form action={action} className="adm-form" data-testid="upload-form" encType="multipart/form-data">
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
