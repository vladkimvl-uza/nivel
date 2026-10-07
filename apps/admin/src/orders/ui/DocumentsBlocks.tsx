// The documents of the order: the report of the commission, the acts, the passport of the build, the warranty cases, and
// the buttons of the PDF documents (switched off by `feature.pdf` until WP-12 exists).
import { Select, TextField } from "@nivel/ui/react";
import {
  advanceWarrantyAction,
  generateActAction,
  generateReportAction,
  openWarrantyAction,
  requestPdfAction,
  resolveObjectionAction,
  savePassportAction,
  sendReportAction,
  signActAction,
} from "../actions.ts";
import { formatDateTime, formatSum } from "../format.ts";
import { ACT_KIND_LABEL, FAULT_LABEL, SIGNED_VIA_LABEL, WARRANTY_STATUS_LABEL } from "../labels.ts";
import type { OrderCard } from "../read-orders.ts";
import { ActionForm } from "./ActionForm.tsx";
import { PhotoPicker } from "./PhotoPicker.tsx";

// ---- the report -----------------------------------------------------------------------------------------------------
export function ReportBlock({ card, canWrite }: { card: OrderCard; canWrite: boolean }) {
  const id = card.order.id;
  const status = card.order.status;
  const latest = card.reports[0];
  const canGenerate = canWrite && (status === "purchasing" || status === "report_due");
  const objection = latest?.objection && !latest.objection.resolved ? latest.objection : null;
  if (card.reports.length === 0 && !canGenerate) return null;
  return (
    <section id="report" data-testid="report" aria-labelledby="report-title">
      <h2 id="report-title">Отчёт комиссионера</h2>
      {card.reports.length > 0 ? (
        <div className="adm-table-wrap">
          <table className="adm-table" data-testid="report-table">
            <thead>
              <tr>
                <th>Версия</th>
                <th className="adm-num">Получено</th>
                <th className="adm-num">Потрачено</th>
                <th className="adm-num">Скидки</th>
                <th className="adm-num">Остаток</th>
                <th>Отправлен</th>
                <th>Принят</th>
              </tr>
            </thead>
            <tbody>
              {card.reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.version}</td>
                  <td className="adm-num">{formatSum(r.receivedSum)}</td>
                  <td className="adm-num">{formatSum(r.spentSum)}</td>
                  <td className="adm-num">{formatSum(r.discountsSum)}</td>
                  <td className="adm-num">{formatSum(r.remainderSum)}</td>
                  <td>{r.sentAt ? formatDateTime(r.sentAt) : "не отправлен"}</td>
                  <td>
                    {r.acceptedAt
                      ? formatDateTime(r.acceptedAt)
                      : r.deemedAcceptedAt
                        ? `по сроку, ${formatDateTime(r.deemedAcceptedAt)}`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="adm-note">Отчёта ещё нет: его собирают из закупок.</p>
      )}
      {objection ? (
        <div className="adm-flash adm-flash--error" data-testid="objection" role="alert">
          <p>Возражение клиента: {objection.text ?? "без текста"}</p>
          {canWrite ? (
            <ActionForm
              action={resolveObjectionAction.bind(null, id)}
              submit="Записать ответ клиенту"
              testId="resolve-objection"
            >
              <TextField id="objection-note" name="note" label="Ответ клиенту" required />
            </ActionForm>
          ) : null}
        </div>
      ) : null}
      {canGenerate ? (
        <div className="adm-actions">
          <ActionForm
            action={generateReportAction.bind(null, id)}
            submit="Сформировать отчёт"
            testId="generate-report"
            resetOnSuccess={false}
          />
          {status === "report_due" && latest ? (
            <ActionForm
              action={sendReportAction.bind(null, id)}
              submit="Отправить отчёт клиенту"
              testId="send-report"
              variant="primary"
            >
              <input type="hidden" name="reportId" value={latest.id} />
              <p className="adm-note">Уйдёт версия {latest.version}: после неё закупки менять нельзя.</p>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---- acts -----------------------------------------------------------------------------------------------------------
export function ActsBlock({ card, canGenerate, canSign }: { card: OrderCard; canGenerate: boolean; canSign: boolean }) {
  const id = card.order.id;
  const unsigned = card.acts.filter((a) => a.signedAt === null);
  if (card.acts.length === 0 && !canGenerate) return null;
  return (
    <section data-testid="acts" aria-labelledby="acts-title">
      <h2 id="acts-title">Акты</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Акт</th>
              <th>Состав</th>
              <th>Подписан</th>
            </tr>
          </thead>
          <tbody>
            {card.acts.length === 0 ? (
              <tr>
                <td colSpan={3}>Актов нет.</td>
              </tr>
            ) : (
              card.acts.map((a) => (
                <tr key={a.id} data-testid={`act-${a.kind}`} data-signed={a.signedAt ? "yes" : "no"}>
                  <td>{ACT_KIND_LABEL[a.kind] ?? a.kind}</td>
                  <td>{a.lines.length > 0 ? a.lines.map((l) => `${l.title} × ${l.qty}`).join("; ") : "—"}</td>
                  <td>
                    {a.signedAt
                      ? `${formatDateTime(a.signedAt)}, ${SIGNED_VIA_LABEL[a.signedVia ?? ""] ?? a.signedVia}`
                      : "ждёт подписи"}
                    {a.evidenceFileId ? (
                      <>
                        {" "}
                        <a href={`/orders/files/${a.evidenceFileId}`} target="_blank" rel="noreferrer">
                          фото акта
                        </a>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {canGenerate ? (
        <details className="adm-card">
          <summary>Составить акт</summary>
          <ActionForm action={generateActAction.bind(null, id)} submit="Составить акт" testId="generate-act">
            <Select
              id="act-kind"
              name="kind"
              label="Вид акта"
              defaultValue="material_acceptance"
              options={Object.entries(ACT_KIND_LABEL).map(([value, label]) => ({ value, label }))}
              hint="Акт приёма материала составляют, когда заказ в статусе «Расчёт сведён»; акт сдачи — когда готов или в доставке."
            />
            <div className="nv-field">
              <label className="nv-field__label" htmlFor="act-lines">
                Состав (для акта приёма материала и возврата деталей)
              </label>
              <textarea
                id="act-lines"
                name="lines"
                className="nv-field__control adm-textarea"
                rows={3}
                placeholder="SSD Samsung 1 ТБ × 2"
              />
            </div>
          </ActionForm>
        </details>
      ) : null}
      {canSign && unsigned.length > 0 ? (
        <div className="adm-card">
          <h3>Подписать бумажный акт</h3>
          <p className="adm-note">
            Акт подписывают на бумаге вместе с клиентом; здесь загружают его фото как подтверждение.
          </p>
          <ActionForm
            action={signActAction.bind(null, id)}
            submit="Записать подпись"
            testId="sign-act"
            variant="primary"
          >
            <Select
              id="sign-act-id"
              name="actId"
              label="Какой акт"
              defaultValue={unsigned[0]?.id}
              options={unsigned.map((a) => ({ value: a.id, label: ACT_KIND_LABEL[a.kind] ?? a.kind }))}
            />
            <PhotoPicker
              name="fileId"
              kind="act_photo"
              endpoint="/orders/upload"
              label="Фото подписанного акта"
              testId="act-picker"
            />
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}

// ---- passport ---------------------------------------------------------------------------------------------------------
const PASSPORT_OPEN = new Set(["assembling", "testing", "ready"]);

export function PassportBlock({ card, canWrite }: { card: OrderCard; canWrite: boolean }) {
  const id = card.order.id;
  const p = card.passport;
  const editable = canWrite && PASSPORT_OPEN.has(card.order.status);
  if (!p && !editable) return null;
  const serials = p
    ? Object.entries(p.serials)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";
  return (
    <section data-testid="passport" aria-labelledby="passport-title">
      <h2 id="passport-title">Паспорт сборки</h2>
      {p ? (
        <dl className="adm-kv">
          <dt>Серийные номера</dt>
          <dd>{serials === "" ? "—" : serials.split("\n").join("; ")}</dd>
          <dt>BIOS · ОС</dt>
          <dd>
            {p.biosVersion ?? "—"} · {p.os ?? "—"}
          </dd>
          <dt>Тест</dt>
          <dd data-testid="passport-tests">
            {p.tests?.minutes !== undefined ? `${p.tests.minutes} мин` : "—"}
            {p.tests?.tool ? ` · ${p.tests.tool}` : ""}
            {p.tests?.peakTempC !== undefined ? ` · пик ${p.tests.peakTempC} °C` : ""}
            {p.tests?.errors && p.tests.errors.length > 0 ? ` · ошибки: ${p.tests.errors.join(", ")}` : " · ошибок нет"}
          </dd>
          <dt>Фото</dt>
          <dd>
            {[...p.photoIds, ...p.sealPhotoIds].length === 0
              ? "—"
              : [...p.photoIds, ...p.sealPhotoIds].map((f, i) => (
                  <a key={f} href={`/orders/files/${f}`} target="_blank" rel="noreferrer">
                    {i > 0 ? ", " : ""}
                    фото {i + 1}
                  </a>
                ))}
          </dd>
        </dl>
      ) : null}
      {editable ? (
        <details className="adm-card" open={!p}>
          <summary>{p ? "Изменить паспорт" : "Заполнить паспорт"}</summary>
          <ActionForm
            action={savePassportAction.bind(null, id)}
            submit="Сохранить паспорт"
            testId="passport-form"
            resetOnSuccess={false}
          >
            <div className="nv-field">
              <label className="nv-field__label" htmlFor="passport-serials">
                Серийные номера
              </label>
              <textarea
                id="passport-serials"
                name="serials"
                className="nv-field__control adm-textarea"
                rows={4}
                defaultValue={serials}
                placeholder="Деталь: номер — по одной в строке"
              />
            </div>
            <div className="adm-grid">
              <TextField
                id="passport-bios"
                name="biosVersion"
                label="Версия BIOS"
                defaultValue={p?.biosVersion ?? ""}
              />
              <TextField id="passport-os" name="os" label="Windows (по чеку)" defaultValue={p?.os ?? ""} />
              <TextField id="passport-tool" name="tool" label="Чем тестировали" defaultValue={p?.tests?.tool ?? ""} />
              <TextField
                id="passport-scenario"
                name="scenario"
                label="Сценарий теста"
                defaultValue={p?.tests?.scenario ?? ""}
              />
              <TextField
                id="passport-minutes"
                name="minutes"
                label="Длительность теста, минут"
                inputMode="numeric"
                defaultValue={p?.tests?.minutes === undefined ? "" : String(p.tests.minutes)}
                hint="Для готовности нужен тест от шести часов без ошибок."
              />
              <TextField
                id="passport-temp"
                name="peakTempC"
                label="Пиковая температура, °C"
                inputMode="numeric"
                defaultValue={p?.tests?.peakTempC === undefined ? "" : String(p.tests.peakTempC)}
              />
              <TextField id="passport-label" name="labelCode" label="Код наклейки" defaultValue={p?.labelCode ?? ""} />
            </div>
            <div className="nv-field">
              <label className="nv-field__label" htmlFor="passport-errors">
                Ошибки теста
              </label>
              <textarea
                id="passport-errors"
                name="errors"
                className="nv-field__control adm-textarea"
                rows={2}
                defaultValue={(p?.tests?.errors ?? []).join("\n")}
                placeholder="Пусто, если ошибок не было"
              />
            </div>
            <PhotoPicker name="photoIds" kind="part_photo" label="Фото сборки" multiple />
            <PhotoPicker name="sealPhotoIds" kind="serial_photo" label="Фото серийных номеров и пломб" multiple />
          </ActionForm>
        </details>
      ) : null}
    </section>
  );
}

// ---- warranty ---------------------------------------------------------------------------------------------------------
const WARRANTY_STEPS: [string, string][] = [
  ["START_DIAGNOSIS", "Начать диагностику"],
  ["SEND_TO_SUPPLIER", "Передать поставщику"],
  ["RESOLVE", "Решён"],
  ["REJECT", "Отказать (по вине клиента)"],
  ["CLOSE", "Закрыть"],
];

export function WarrantyBlock({ card, canWrite }: { card: OrderCard; canWrite: boolean }) {
  const id = card.order.id;
  const handed = card.order.status === "handed_over" || card.order.status === "closed";
  if (card.warranty.length === 0 && !(canWrite && handed)) return null;
  return (
    <section data-testid="warranty" aria-labelledby="warranty-title">
      <h2 id="warranty-title">Гарантия</h2>
      {card.warranty.length === 0 ? <p className="adm-note">Гарантийных случаев нет.</p> : null}
      {card.warranty.map((w) => (
        <div key={w.id} className="adm-card" data-testid={`warranty-${w.number}`}>
          <p>
            <strong>{w.number}</strong> · {WARRANTY_STATUS_LABEL[w.status] ?? w.status} · открыт{" "}
            {formatDateTime(w.openedAt)}
          </p>
          <p>{w.description}</p>
          <p className="adm-note">
            Ответить до {formatDateTime(w.dueReply)} · диагностика до {formatDateTime(w.dueDiagnosis)} · устранить до{" "}
            {formatDateTime(w.dueFix)}
            {w.clientFault ? ` · отказ: ${FAULT_LABEL[w.clientFault] ?? w.clientFault}` : ""}
          </p>
          {canWrite && w.status !== "closed" ? (
            <details>
              <summary>Следующий шаг</summary>
              <ActionForm
                action={advanceWarrantyAction.bind(null, id, w.id)}
                submit="Выполнить"
                testId={`advance-${w.number}`}
              >
                <Select
                  id={`warranty-event-${w.id}`}
                  name="event"
                  label="Действие"
                  options={WARRANTY_STEPS.map(([value, label]) => ({ value, label }))}
                />
                <Select
                  id={`warranty-fault-${w.id}`}
                  name="clientFault"
                  label="Причина отказа"
                  defaultValue=""
                  options={[
                    { value: "", label: "—" },
                    ...Object.entries(FAULT_LABEL).map(([value, label]) => ({ value, label })),
                  ]}
                  hint="Отказ возможен только с причинной связью и описанием доказательства."
                />
                <TextField id={`warranty-evidence-${w.id}`} name="evidence" label="Доказательство" />
              </ActionForm>
            </details>
          ) : null}
        </div>
      ))}
      {canWrite && handed ? (
        <details className="adm-card">
          <summary>Открыть гарантийный случай</summary>
          <ActionForm action={openWarrantyAction.bind(null, id)} submit="Открыть случай" testId="open-warranty">
            <div className="nv-field">
              <label className="nv-field__label" htmlFor="warranty-description">
                Что случилось
              </label>
              <textarea
                id="warranty-description"
                name="description"
                className="nv-field__control adm-textarea"
                rows={3}
                required
              />
            </div>
          </ActionForm>
        </details>
      ) : null}
    </section>
  );
}

// ---- the PDF documents (WP-12) -------------------------------------------------------------------------------------------
interface PdfRow {
  doc: string;
  label: string;
  actId?: string;
  files: { uz: string | null; ru: string | null };
}

function pdfRows(card: OrderCard): PdfRow[] {
  const rows: PdfRow[] = [];
  if (card.quote) rows.push({ doc: "quote", label: "Смета", files: card.quote.pdf });
  if (card.reports[0]) rows.push({ doc: "commission_report", label: "Отчёт комиссионера", files: card.reports[0].pdf });
  const ACT_DOC: Record<string, string> = {
    material_acceptance: "act_materials",
    customer_parts: "act_customer_parts",
    handover: "act_handover",
  };
  for (const a of card.acts) {
    rows.push({
      doc: ACT_DOC[a.kind] ?? "act_handover",
      label: ACT_KIND_LABEL[a.kind] ?? "Акт",
      actId: a.id,
      files: a.pdf,
    });
  }
  if (card.passport) rows.push({ doc: "passport", label: "Паспорт сборки", files: card.passport.pdf });
  return rows;
}

/** Shown only with `feature.pdf` on: the screens work without it (the documents are made by the worker of WP-12). */
export function PdfBlock({ card, canRender }: { card: OrderCard; canRender: boolean }) {
  const rows = pdfRows(card);
  return (
    <section data-testid="pdf" aria-labelledby="pdf-title">
      <h2 id="pdf-title">Документы PDF</h2>
      {rows.length === 0 ? <p className="adm-note">Документов для заказа пока нет.</p> : null}
      {rows.map((r) => (
        <div key={`${r.doc}-${r.actId ?? ""}`} className="adm-actions" data-testid={`pdf-${r.doc}`}>
          <span>{r.label}:</span>
          {r.files.uz ? <a href={`/orders/files/${r.files.uz}`}>uz</a> : <span className="adm-note">uz ещё нет</span>}
          {r.files.ru ? <a href={`/orders/files/${r.files.ru}`}>ru</a> : <span className="adm-note">ru ещё нет</span>}
          {canRender ? (
            <ActionForm
              action={requestPdfAction.bind(null, card.order.id, card.order.number)}
              submit="Сформировать заново"
              testId={`render-${r.doc}`}
              className="adm-inline"
            >
              <input type="hidden" name="doc" value={r.doc} />
              {r.actId ? <input type="hidden" name="actId" value={r.actId} /> : null}
            </ActionForm>
          ) : null}
        </div>
      ))}
    </section>
  );
}
