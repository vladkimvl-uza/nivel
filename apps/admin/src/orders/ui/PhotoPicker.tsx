"use client";

// A photo from the phone for a form of the orders screens: the camera opens from the field, the picture goes to the
// upload route (which strips the shooting data and registers the file), and the form then carries the id of the file.
// The picture is sent at once, before the form: the form itself stays small.
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { refuseBeforeSending, sendPhoto } from "./upload-client.ts";

export const HEIC_HINT =
  "Снимок в JPEG, PNG или WebP до 12 МБ. Фото с iPhone в формате HEIC не принимается: отправьте его себе через Telegram или включите «Камера → Форматы → Наиболее совместимый».";

interface Uploaded {
  id: string;
  name: string;
}

export interface PhotoPickerProps {
  /** Name of the hidden field that carries the id of each uploaded file. */
  name: string;
  kind: string;
  label: string;
  /** `/files/upload` takes the kinds of the base admin; `/orders/upload` those of the orders (act photo, statement). */
  endpoint?: string;
  multiple?: boolean;
  testId?: string;
  hint?: string;
}

export function PhotoPicker({
  name,
  kind,
  label,
  endpoint = "/files/upload",
  multiple = false,
  testId,
  hint = HEIC_HINT,
}: PhotoPickerProps) {
  const inputId = useId();
  const [items, setItems] = useState<Uploaded[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  // The form is cleared after a success: the uploaded files are forgotten with the other fields.
  useEffect(() => {
    const form = holder.current?.closest("form");
    if (!form) return;
    const clear = () => {
      setItems([]);
      setMessage(null);
    };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    const added: Uploaded[] = [];
    for (const file of files) {
      const refused = refuseBeforeSending(file);
      if (refused) {
        setMessage({ ok: false, text: refused });
        continue;
      }
      const answer = await sendPhoto(endpoint, file, kind);
      if (answer.ok && answer.file) added.push({ id: answer.file.id, name: file.name });
      else setMessage({ ok: false, text: answer.message ?? "Файл не загружен." });
    }
    if (added.length > 0) {
      setItems((current) => (multiple ? [...current, ...added] : added));
      setMessage({ ok: true, text: `Файл загружен: ${added.map((a) => a.name).join(", ")}` });
    }
    setBusy(false);
    input.value = "";
  }

  return (
    <div className="nv-field" ref={holder} data-testid={testId}>
      <label className="nv-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        className="nv-field__control"
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        disabled={busy}
        onChange={onChange}
        style={{ paddingTop: 10 }}
      />
      <p className="nv-field__hint">{hint}</p>
      {busy ? <p className="adm-note">Загружаю…</p> : null}
      {message ? (
        <p
          className={message.ok ? "adm-flash adm-flash--ok" : "adm-flash adm-flash--error"}
          role={message.ok ? "status" : "alert"}
          data-testid={testId ? `${testId}-message` : undefined}
        >
          {message.text}
        </p>
      ) : null}
      {items.map((item) => (
        <input key={item.id} type="hidden" name={name} value={item.id} />
      ))}
    </div>
  );
}
