import { Button } from "@nivel/ui/react";
import type { Metadata } from "next";
import { requireUser } from "../../../../src/auth/next.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { saveCatalogAction } from "../../../../src/kit/catalog/actions.ts";
import { categoryNames } from "../../../../src/kit/catalog/categories.ts";
import { CATALOG_LABELS, OPTION_LABELS, SPEC_GROUPS } from "../../../../src/kit/catalog/labels.ts";
import { first } from "../../../../src/kit/ui/Pager.tsx";
import { SchemaForm } from "../../../../src/kit/ui/SchemaForm.tsx";
import { PageTitle } from "../../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Новая позиция" };
export const dynamic = "force-dynamic";

export default async function NewPositionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser(["catalog.write"]);
  const runtime = getRuntime();
  const category = first((await searchParams).category);
  const names = await categoryNames(runtime.db);
  const arms = runtime.catalog.root.arms ?? {};

  if (!category || !Object.hasOwn(arms, category)) {
    return (
      <>
        <PageTitle
          title="Новая позиция"
          lead="Сначала категория: от неё зависит, какие характеристики нужно заполнить."
        />
        <form method="get" action="/catalog/new" className="adm-form" data-testid="category-chooser">
          <div className="nv-field">
            <label className="nv-field__label" htmlFor="category">
              Категория
            </label>
            <span className="nv-select">
              <select className="nv-field__control" id="category" name="category" defaultValue="">
                <option value="" disabled>
                  Выберите
                </option>
                {Object.keys(arms).map((code) => (
                  <option key={code} value={code}>
                    {names[code] ?? code}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="adm-actions">
            <Button type="submit" mark>
              Дальше
            </Button>
          </div>
        </form>
      </>
    );
  }

  const specSections = SPEC_GROUPS[category];
  const initial = { category, status: "draft", isDemo: false, spec: {} };
  const model = runtime.catalog.formModel(initial);
  return (
    <>
      <PageTitle
        title={`Новая позиция: ${names[category] ?? category}`}
        lead="Чего не знаете — оставьте пустым или отметьте «неизвестно»: позицию можно будет подтвердить, когда заполнены ключевые характеристики."
      />
      <SchemaForm
        action={saveCatalogAction}
        initial={{ errors: {}, values: initial }}
        fields={model.fields}
        labels={CATALOG_LABELS}
        optionLabels={{ ...OPTION_LABELS, category: names }}
        hiddenNames={runtime.catalog.hiddenNames(initial)}
        {...(specSections ? { sections: { spec: specSections } } : {})}
        submitLabel="Создать позицию"
        testId="catalog-form"
      />
    </>
  );
}
