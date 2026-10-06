import { Badge, Button } from "@nivel/ui/react";
import type { Metadata } from "next";
import { requireUser } from "../../../src/auth/next.ts";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { categoryNames, STATUS_NAMES } from "../../../src/kit/catalog/categories.ts";
import type { CatalogValue } from "../../../src/kit/catalog/resource.ts";
import { first, listHref, Pager } from "../../../src/kit/ui/Pager.tsx";
import { PageTitle } from "../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Каталог" };
export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["catalog.read"]);
  const runtime = getRuntime();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)]));
  const [page, categories] = await Promise.all([runtime.catalog.list(user, query), categoryNames(runtime.db)]);
  const canWrite = runtime.catalog.can(user, "write");
  const kept = Object.fromEntries(page.filters.map((f) => [f.def.field, f.value || undefined]));

  return (
    <>
      <PageTitle
        title="Каталог"
        lead="Позиции с характеристиками для подбора и проверки совместимости. Пока позиция — черновик, в подбор она не попадает."
      />
      <div className="adm-actions">
        {canWrite ? (
          <>
            <Button href="/catalog/new" mark>
              Новая позиция
            </Button>
            <Button href="/catalog/import" variant="ghost">
              Импорт из файла
            </Button>
          </>
        ) : (
          <span className="adm-note">Каталог доступен для просмотра. Менять его может владелец.</span>
        )}
      </div>

      <form className="adm-filters" method="get" action="/catalog" data-testid="catalog-filters">
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="flt-category">
            Категория
          </label>
          <span className="nv-select">
            <select className="nv-field__control" id="flt-category" name="category" defaultValue={kept.category ?? ""}>
              <option value="">Все</option>
              {Object.entries(categories).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="flt-status">
            Статус
          </label>
          <span className="nv-select">
            <select className="nv-field__control" id="flt-status" name="status" defaultValue={kept.status ?? ""}>
              <option value="">Все</option>
              {Object.entries(STATUS_NAMES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="flt-q">
            Поиск
          </label>
          <input
            className="nv-field__control"
            id="flt-q"
            name="q"
            defaultValue={kept.q ?? ""}
            placeholder="бренд, модель, артикул"
          />
        </div>
        <Button type="submit" variant="ghost">
          Показать
        </Button>
      </form>

      <div className="adm-table-wrap">
        <table className="adm-table" data-testid="catalog-table">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Бренд</th>
              <th>Модель</th>
              <th>Артикул</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.length === 0 ? (
              <tr>
                <td colSpan={5}>Позиций нет.</td>
              </tr>
            ) : (
              page.rows.map((row) => {
                const v = row.value as CatalogValue;
                return (
                  <tr key={row.id} data-testid="catalog-row">
                    <td>{categories[v.category] ?? v.category}</td>
                    <td>{v.brand}</td>
                    <td>
                      <a href={`/catalog/${row.id}`}>{v.model}</a>
                    </td>
                    <td>{v.mpn ?? "—"}</td>
                    <td>
                      {v.status === "draft" ? (
                        <Badge kind="draft" label={STATUS_NAMES.draft ?? "Черновик"} />
                      ) : (
                        STATUS_NAMES[v.status]
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pager
        page={page.page}
        pages={page.pages}
        total={page.total}
        hrefFor={(n) => listHref("/catalog", { ...kept, page: n === 1 ? undefined : String(n) })}
      />
    </>
  );
}
