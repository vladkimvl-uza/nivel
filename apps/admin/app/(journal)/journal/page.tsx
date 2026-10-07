import { Button } from "@nivel/ui/react";
import type { Metadata } from "next";
import { requireUser } from "../../../src/auth/next.ts";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { listJournal, listJournalEntities } from "../../../src/kit/journal/journal.pg.ts";
import { parseJournalQuery } from "../../../src/kit/journal/journal.ts";
import { first, listHref, Pager } from "../../../src/kit/ui/Pager.tsx";
import { PageTitle } from "../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Журнал" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Tashkent" });

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["journal.read"]);
  const { db } = getRuntime();
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)]));
  const query = parseJournalQuery(flat);
  const [result, entities] = await Promise.all([listJournal(db, user, query), listJournalEntities(db, user)]);
  const kept = { entity: flat.entity, actor: flat.actor, action: flat.action, from: flat.from, to: flat.to };

  return (
    <>
      <PageTitle
        title="Журнал"
        lead="Входы, изменения настроек, каталога и файлов. Записи только добавляются: исправить или удалить их нельзя."
      />
      <form className="adm-filters" method="get" action="/journal" data-testid="journal-filters">
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="j-entity">
            Объект
          </label>
          <span className="nv-select">
            <select className="nv-field__control" id="j-entity" name="entity" defaultValue={flat.entity ?? ""}>
              <option value="">Все</option>
              {entities.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="j-action">
            Действие начинается с
          </label>
          <input
            className="nv-field__control"
            id="j-action"
            name="action"
            defaultValue={flat.action ?? ""}
            placeholder="auth."
          />
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="j-actor">
            Кто
          </label>
          <input
            className="nv-field__control"
            id="j-actor"
            name="actor"
            defaultValue={flat.actor ?? ""}
            placeholder="admin:…"
          />
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="j-from">
            С даты
          </label>
          <input className="nv-field__control" id="j-from" name="from" type="date" defaultValue={flat.from ?? ""} />
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="j-to">
            По дату
          </label>
          <input className="nv-field__control" id="j-to" name="to" type="date" defaultValue={flat.to ?? ""} />
        </div>
        <Button type="submit" variant="ghost">
          Показать
        </Button>
      </form>

      <div className="adm-table-wrap">
        <table className="adm-table" data-testid="journal-table">
          <thead>
            <tr>
              <th>Когда (Ташкент)</th>
              <th>Кто</th>
              <th>Что</th>
              <th>Объект</th>
              <th>Изменено</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={5}>Записей нет.</td>
              </tr>
            ) : (
              result.rows.map((r) => (
                <tr key={r.id} data-action={r.action}>
                  <td className="adm-num">{WHEN.format(r.at)}</td>
                  <td>{r.actor}</td>
                  <td title={r.action}>{r.title}</td>
                  <td>
                    {r.entity}
                    {r.entityId ? ` · ${r.entityId}` : ""}
                  </td>
                  <td>{r.changed.length > 0 ? r.changed.join(", ") : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager
        page={query.page}
        pages={result.pages}
        total={result.total}
        hrefFor={(n) => listHref("/journal", { ...kept, page: n === 1 ? undefined : String(n) })}
      />
    </>
  );
}
