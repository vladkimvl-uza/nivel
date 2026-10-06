"use client";

// Client parts of the catalog screens: the import from a file (preview, then apply) and the status buttons.
import { Badge, Button } from "@nivel/ui/react";
import { useActionState } from "react";
import {
  applyImportAction,
  type ImportState,
  previewImportAction,
  type StatusState,
  setCatalogStatusAction,
} from "./actions.ts";

const STATUS_LABEL = { new: "новая", update: "обновление", error: "ошибка" } as const;

export function ImportForm() {
  const [preview, previewAction, previewing] = useActionState<ImportState, FormData>(previewImportAction, {
    phase: "idle",
  });
  const [applied, applyAction, applying] = useActionState<ImportState, FormData>(applyImportAction, { phase: "idle" });

  if (applied.phase === "applied") {
    return (
      <section data-testid="import-result" aria-live="polite">
        <p className="adm-flash adm-flash--ok" role="status">
          Готово: создано {applied.applied?.created ?? 0}, обновлено {applied.applied?.updated ?? 0}
          {applied.failed && applied.failed.length > 0 ? `, не загружено ${applied.failed.length}` : ""}.
        </p>
        {applied.failed && applied.failed.length > 0 ? (
          <ul>
            {applied.failed.map((f) => (
              <li key={f.line}>
                Строка {f.line}: {f.message}
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          <a href="/catalog">К списку позиций</a>
        </p>
      </section>
    );
  }

  return (
    <div className="adm-form">
      <form action={previewAction} className="adm-form" data-testid="import-form">
        {preview.phase === "error" ? (
          <p className="adm-flash adm-flash--error" role="alert">
            {preview.error}
          </p>
        ) : null}
        {applied.phase === "error" ? (
          <p className="adm-flash adm-flash--error" role="alert">
            {applied.error}
          </p>
        ) : null}
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="import-file">
            Файл CSV
          </label>
          <input
            className="nv-field__control"
            id="import-file"
            name="file"
            type="file"
            accept=".csv,text/csv,text/plain"
            style={{ paddingTop: 10 }}
          />
          <p className="nv-field__hint">
            Первая строка — названия столбцов (шаблон можно скачать выше). Разделитель — запятая, точка с запятой или
            табуляция. До 1 МБ и 2000 строк.
          </p>
        </div>
        <div className="adm-actions">
          <Button type="submit" disabled={previewing} variant="ghost">
            {previewing ? "Проверяю…" : "Проверить файл"}
          </Button>
        </div>
      </form>

      {preview.phase === "preview" && preview.rows && preview.counts ? (
        <section data-testid="import-preview" aria-live="polite">
          <h2>Предпросмотр</h2>
          <p>
            Новых: <strong data-testid="count-new">{preview.counts.new}</strong> · обновлений:{" "}
            <strong data-testid="count-update">{preview.counts.update}</strong> · с ошибками:{" "}
            <strong data-testid="count-error">{preview.counts.error}</strong>
          </p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th className="adm-num">Строка</th>
                  <th>Что с ней будет</th>
                  <th>Позиция</th>
                  <th>Ошибки</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} data-status={r.status}>
                    <td className="adm-num">{r.line}</td>
                    <td>
                      {r.status === "error" ? (
                        <Badge kind="draft" label={STATUS_LABEL.error} />
                      ) : (
                        STATUS_LABEL[r.status]
                      )}
                    </td>
                    <td>{r.label}</td>
                    <td>
                      {r.errors.map((e) => (
                        <div key={`${e.field}:${e.message}`}>{e.field ? `${e.field}: ${e.message}` : e.message}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.counts.new + preview.counts.update > 0 ? (
            <form action={applyAction} className="adm-actions" style={{ marginTop: 16 }}>
              <input type="hidden" name="csv" value={preview.csv ?? ""} />
              <Button type="submit" disabled={applying} mark>
                {applying
                  ? "Загружаю…"
                  : `Загрузить ${preview.counts.new + preview.counts.update} ${preview.counts.error > 0 ? "верных строк" : "строк"}`}
              </Button>
              {preview.counts.error > 0 ? <span className="adm-note">Строки с ошибками будут пропущены.</span> : null}
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const STATUS_TARGETS = [
  { status: "verified", label: "Подтвердить", variant: undefined },
  { status: "retired", label: "Снять с продажи", variant: "ghost" as const },
  { status: "draft", label: "Вернуть в черновик", variant: "ghost" as const },
];

const STATUS_NAME: Record<string, string> = { draft: "Черновик", verified: "Проверено", retired: "Снято" };

export function StatusControls({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState<StatusState, FormData>(setCatalogStatusAction, {});
  return (
    <section aria-labelledby="status-title" data-testid="status-controls">
      <h2 id="status-title">
        Статус: <span data-testid="status-name">{STATUS_NAME[status] ?? status}</span>
      </h2>
      {state.error ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="adm-actions">
        {STATUS_TARGETS.filter((t) => t.status !== status).map((t) => (
          <form key={t.status} action={action} className="adm-inline">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={t.status} />
            <Button type="submit" disabled={pending} {...(t.variant ? { variant: t.variant } : {})}>
              {t.label}
            </Button>
          </form>
        ))}
      </div>
      <p className="adm-note">
        «Подтвердить» принимает только позицию, у которой заполнены ключевые характеристики для правил совместимости.
      </p>
    </section>
  );
}
