import type { Metadata } from "next";
import { requireUser } from "../../../src/auth/next.ts";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { listRecentFiles } from "../../../src/kit/upload/registry.pg.ts";
import { UPLOAD_KINDS } from "../../../src/kit/upload/save.ts";
import { PhotoUploadForm } from "../../../src/kit/upload/ui.tsx";
import { PageTitle } from "../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Файлы" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tashkent" });

export default async function FilesPage() {
  await requireUser(["upload.write"]);
  const files = await listRecentFiles(getRuntime().db, 20);
  const kinds = Object.entries(UPLOAD_KINDS).map(([value, k]) => ({ value, label: k.label }));
  return (
    <>
      <PageTitle
        title="Файлы"
        lead="Фото чеков, счетов-фактур, деталей и серийных номеров. С телефона камера открывается из поля выбора файла. Данные съёмки и геопозиция из снимка удаляются до сохранения."
      />
      <PhotoUploadForm kinds={kinds} />
      <h2>Последние файлы</h2>
      <div className="adm-table-wrap">
        <table className="adm-table" data-testid="files-table">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Вид</th>
              <th>Тип</th>
              <th className="adm-num">Байт</th>
              <th>Кто</th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 ? (
              <tr>
                <td colSpan={5}>Файлов нет.</td>
              </tr>
            ) : (
              files.map((f) => (
                <tr key={f.id}>
                  <td className="adm-num">{WHEN.format(f.created_at)}</td>
                  <td>{UPLOAD_KINDS[f.kind]?.label ?? f.kind}</td>
                  <td>{f.mime}</td>
                  <td className="adm-num">{f.bytes}</td>
                  <td>{f.created_by ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
