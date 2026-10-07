// Pages of a list: previous, next, "page N of M". Links are plain addresses with the filters kept.

export function listHref(base: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, value);
  const text = query.toString();
  return text === "" ? base : `${base}?${text}`;
}

export function Pager({
  page,
  pages,
  total,
  hrefFor,
}: {
  page: number;
  pages: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <nav className="adm-pager" aria-label="Страницы">
      {page > 1 ? <a href={hrefFor(page - 1)}>← Назад</a> : <span aria-hidden="true">← Назад</span>}
      <span>
        Страница {page} из {pages} · всего {total}
      </span>
      {page < pages ? <a href={hrefFor(page + 1)}>Вперёд →</a> : <span aria-hidden="true">Вперёд →</span>}
    </nav>
  );
}

/** First value of a search parameter, as a string. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
