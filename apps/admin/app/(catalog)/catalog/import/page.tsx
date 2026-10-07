import type { Metadata } from "next";
import { requireUser } from "../../../../src/auth/next.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { categoryNames } from "../../../../src/kit/catalog/categories.ts";
import { ImportForm } from "../../../../src/kit/catalog/ui.tsx";
import { PageTitle } from "../../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Импорт из файла" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireUser(["catalog.import"]);
  const runtime = getRuntime();
  const names = await categoryNames(runtime.db);
  const codes = Object.keys(runtime.catalog.root.arms ?? {});
  return (
    <>
      <PageTitle
        title="Импорт из файла"
        lead="Загрузите CSV: сначала покажем, что в нём будет создано, обновлено и что не прошло проверку, и только потом запишем. Позиция из файла всегда попадает как черновик."
      />
      <h2>Шаблон файла по категории</h2>
      <p className="adm-note">
        В шаблоне — все столбцы категории: общие (бренд, модель, артикул) и характеристики в виде spec.имя.
      </p>
      <ul data-testid="templates">
        {codes.map((code) => (
          <li key={code}>
            <a href={`/catalog/template?category=${code}`}>{names[code] ?? code}</a>
          </li>
        ))}
      </ul>
      <h2>Файл</h2>
      <ImportForm />
    </>
  );
}
