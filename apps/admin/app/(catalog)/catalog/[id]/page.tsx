import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "../../../../src/auth/next.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { saveCatalogAction } from "../../../../src/kit/catalog/actions.ts";
import { categoryNames } from "../../../../src/kit/catalog/categories.ts";
import { CATALOG_LABELS, OPTION_LABELS, SPEC_GROUPS } from "../../../../src/kit/catalog/labels.ts";
import { StatusControls } from "../../../../src/kit/catalog/ui.tsx";
import { listHistory } from "../../../../src/kit/journal/journal.pg.ts";
import { first } from "../../../../src/kit/ui/Pager.tsx";
import { SchemaForm } from "../../../../src/kit/ui/SchemaForm.tsx";
import { PageTitle } from "../../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Позиция" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Tashkent" });

export default async function PositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["catalog.read"]);
  const { id } = await params;
  const runtime = getRuntime();
  const stored = await runtime.catalog.get(user, id);
  if (!stored) notFound();
  const created = first((await searchParams).created) === "1";
  const [names, history] = await Promise.all([
    categoryNames(runtime.db),
    listHistory(runtime.db, user, "catalog.products", id),
  ]);
  const value = stored.value;
  const model = runtime.catalog.formModel(value);
  const writable = runtime.catalog.can(user, "write");
  const specSections = SPEC_GROUPS[value.category];

  return (
    <>
      <PageTitle
        title={`${value.brand} ${value.model}`}
        lead={`${names[value.category] ?? value.category}${value.mpn ? ` · ${value.mpn}` : ""}`}
      />
      {created ? (
        <p className="adm-flash adm-flash--ok" role="status" data-testid="created-flash">
          Позиция создана.
        </p>
      ) : null}
      {writable ? (
        <>
          <SchemaForm
            action={saveCatalogAction}
            initial={{ errors: {}, values: value }}
            fields={model.fields}
            labels={CATALOG_LABELS}
            optionLabels={{ ...OPTION_LABELS, category: names }}
            hiddenNames={runtime.catalog.hiddenNames(value)}
            hidden={{ id }}
            {...(specSections ? { sections: { spec: specSections } } : {})}
            submitLabel="Сохранить"
            testId="catalog-form"
          />
          <StatusControls id={id} status={value.status} />
        </>
      ) : (
        <p className="adm-flash">Просмотр: менять каталог может владелец.</p>
      )}

      <h2>История изменений</h2>
      {history.length === 0 ? (
        <p className="adm-note">Записей нет.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table" data-testid="history">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Кто</th>
                <th>Что</th>
                <th>Изменено</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="adm-num">{WHEN.format(h.at)}</td>
                  <td>{h.actor}</td>
                  <td>{h.title}</td>
                  <td>{h.changed.length > 0 ? h.changed.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
