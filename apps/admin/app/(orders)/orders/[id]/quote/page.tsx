import { UuidSchema } from "@nivel/contracts/orders";
import { Button, Select, TextField } from "@nivel/ui/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRuntime } from "../../../../../src/auth/runtime.ts";
import { canDo } from "../../../../../src/orders/access.ts";
import { rebuildQuoteAction, rememberTasksAction, sendQuoteAction } from "../../../../../src/orders/actions.ts";
import { formatSum } from "../../../../../src/orders/format.ts";
import { STATUS_LABEL } from "../../../../../src/orders/labels.ts";
import { requireOrdersUser } from "../../../../../src/orders/next.ts";
import { getOrderCard } from "../../../../../src/orders/read-orders.ts";
import { listCategories, searchCatalog } from "../../../../../src/orders/read-quote.ts";
import { ActionForm } from "../../../../../src/orders/ui/ActionForm.tsx";
import { Title } from "../../../../../src/orders/ui/OrdersShell.tsx";
import { QuoteLines, QuoteTotals, QuoteWarnings } from "../../../../../src/orders/ui/QuoteBlock.tsx";

export const metadata: Metadata = { title: "Смета" };
export const dynamic = "force-dynamic";

const TASKS: [string, string][] = [
  ["gaming", "Игры"],
  ["streaming", "Стриминг"],
  ["design3d", "3D и дизайн"],
  ["programming", "Программирование"],
  ["office", "Офис"],
];
const FEE_GROUPS: [string, string][] = [
  ["pc", "Детали ПК"],
  ["mount", "Монтаж и работы"],
  ["outside_scale", "Вне шкалы платы (лицензии, доставка)"],
];

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export default async function QuoteEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOrdersUser(["orders.read"]);
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) notFound();
  const query = await searchParams;
  const { db } = getRuntime();
  const card = await getOrderCard(db, id, { seePhone: false });
  if (!card) notFound();
  const tasks = list(query.tasks).filter((t) => TASKS.some(([v]) => v === t));
  const search = list(query.q)[0] ?? "";
  const editable = canDo(user.role, "quotes.write") && card.order.status === "estimate_draft";
  const canSend = canDo(user.role, "quotes.send") && editable && card.quote?.status === "draft";
  const [found, categories] = editable ? await Promise.all([searchCatalog(db, search), listCategories(db)]) : [[], []];
  const quote = card.quote;

  const hidden = (change: string) => (
    <>
      <input type="hidden" name="change" value={change} />
      {tasks.map((t) => (
        <input key={t} type="hidden" name="tasks" value={t} />
      ))}
    </>
  );

  return (
    <>
      <p className="adm-crumbs">
        <a href="/orders">Заказы</a>
        <a href={`/orders/${id}`}>{card.order.number}</a>
        <span>Смета</span>
      </p>
      <Title
        title={`Смета ${card.order.number}`}
        lead="Строки считает сервер: цены берутся из рынка на дату, плата и лимит — по шкале владельца. Здесь ничего не складывается вручную."
      />
      <p className="nv-tag" data-testid="quote-order-status">
        {STATUS_LABEL[card.order.status]}
      </p>
      {!editable ? (
        <p className="adm-flash" data-testid="quote-readonly">
          Смету можно менять, пока заказ в статусе «{STATUS_LABEL.estimate_draft}» и роль владельца. Если смета
          отправлена и нужно её изменить, верните её в работу на странице заказа.
        </p>
      ) : null}

      {editable ? (
        <ActionForm
          action={rememberTasksAction.bind(null, id)}
          submit="Запомнить задачи"
          className="adm-filters"
          testId="tasks-form"
          resetOnSuccess={false}
        >
          <input type="hidden" name="change" value="recalc" />
          <fieldset className="adm-group">
            <legend>Задачи сборки (до двух) — для проверки совместимости</legend>
            <div className="adm-checks">
              {TASKS.map(([value, label]) => (
                <label key={value} className="adm-check">
                  <input type="checkbox" name="tasks" value={value} defaultChecked={tasks.includes(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {search ? <input type="hidden" name="q" value={search} /> : null}
          {tasks.length === 0 && quote ? (
            <p className="adm-note" data-testid="tasks-empty">
              Задачи не выбраны: проверка совместимости идёт без них. Выберите и нажмите «Запомнить задачи» — смета
              пересчитается.
            </p>
          ) : null}
        </ActionForm>
      ) : null}

      <h2>Итоги расчёта</h2>
      {quote ? (
        <>
          <QuoteTotals quote={quote} />
          <QuoteWarnings quote={quote} />
          <h2>Строки</h2>
          <QuoteLines quote={quote} />
        </>
      ) : (
        <p className="adm-note" data-testid="quote-empty">
          В смете пока нет строк: добавьте позиции каталога ниже.
        </p>
      )}

      {editable && quote ? (
        <>
          <h2>Изменить строки</h2>
          <div className="adm-table-wrap">
            <table className="adm-table ord-lines" data-testid="quote-edit-lines">
              <thead>
                <tr>
                  <th>Позиция</th>
                  <th>Количество</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((l, i) => {
                  const manualIndex =
                    l.productId === null ? quote.lines.slice(0, i).filter((x) => x.productId === null).length : -1;
                  return (
                    <tr key={l.id}>
                      <td>{l.title}</td>
                      <td>
                        {l.productId ? (
                          <ActionForm
                            action={rebuildQuoteAction.bind(null, id)}
                            submit="Изменить"
                            className="adm-inline"
                            testId={`qty-${l.productId}`}
                            resetOnSuccess={false}
                          >
                            {hidden("qty")}
                            <input type="hidden" name="productId" value={l.productId} />
                            <input
                              className="nv-field__control ord-inline-field"
                              name="qty"
                              defaultValue={l.qty}
                              inputMode="numeric"
                              aria-label={`Количество: ${l.title}`}
                            />
                          </ActionForm>
                        ) : (
                          l.qty
                        )}
                      </td>
                      <td>
                        <div className="adm-actions">
                          {l.productId ? (
                            <>
                              <ActionForm
                                action={rebuildQuoteAction.bind(null, id)}
                                submit={l.customerOwned ? "Закупает ИП" : "Свои детали клиента"}
                                className="adm-inline"
                                testId={`owned-${l.productId}`}
                                resetOnSuccess={false}
                              >
                                {hidden("owned")}
                                <input type="hidden" name="productId" value={l.productId} />
                              </ActionForm>
                              <ActionForm
                                action={rebuildQuoteAction.bind(null, id)}
                                submit="Убрать"
                                className="adm-inline"
                                testId={`remove-${l.productId}`}
                                resetOnSuccess={false}
                              >
                                {hidden("remove")}
                                <input type="hidden" name="productId" value={l.productId} />
                              </ActionForm>
                            </>
                          ) : (
                            <ActionForm
                              action={rebuildQuoteAction.bind(null, id)}
                              submit="Убрать строку"
                              className="adm-inline"
                              testId={`remove-manual-${manualIndex}`}
                              resetOnSuccess={false}
                            >
                              {hidden("removeManual")}
                              <input type="hidden" name="index" value={manualIndex} />
                            </ActionForm>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {editable ? (
        <>
          <h2>Добавить из каталога</h2>
          <form className="adm-filters" method="get" action={`/orders/${id}/quote`} data-testid="catalog-search">
            <TextField id="catalog-q" name="q" label="Бренд, модель или категория" defaultValue={search} />
            {tasks.map((t) => (
              <input key={t} type="hidden" name="tasks" value={t} />
            ))}
            <Button type="submit" variant="ghost">
              Найти
            </Button>
          </form>
          <div className="adm-table-wrap">
            <table className="adm-table" data-testid="catalog-results">
              <thead>
                <tr>
                  <th>Позиция</th>
                  <th>Категория</th>
                  <th className="adm-num">Цена на рынке</th>
                  <th>Доверие</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {found.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Ничего не найдено.</td>
                  </tr>
                ) : (
                  found.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.title}
                        {p.manualOnly ? <span className="adm-note"> · только вручную</span> : null}
                      </td>
                      <td>{p.category}</td>
                      <td className="adm-num">{formatSum(p.priceSum)}</td>
                      <td>
                        {p.confidence
                          ? `${p.confidence}, ${p.priceDate?.split("-").reverse().join(".") ?? ""}`
                          : "цены нет"}
                      </td>
                      <td>
                        <ActionForm
                          action={rebuildQuoteAction.bind(null, id)}
                          submit="Добавить"
                          className="adm-inline"
                          testId={`add-${p.id}`}
                          resetOnSuccess={false}
                        >
                          {hidden("add")}
                          <input type="hidden" name="productId" value={p.id} />
                          <input type="hidden" name="qty" value="1" />
                        </ActionForm>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2>Добавить строку вручную</h2>
          <p className="adm-note">Работы, лицензия, услуга партнёра. Цену вводите целым числом сумов.</p>
          <ActionForm action={rebuildQuoteAction.bind(null, id)} submit="Добавить строку" testId="add-manual-line">
            {hidden("addManual")}
            <div className="adm-grid">
              <TextField id="manual-title" name="title" label="Название" />
              <Select
                id="manual-category"
                name="categoryCode"
                label="Категория"
                defaultValue={categories[0]?.code}
                options={categories.map((c) => ({ value: c.code, label: c.name }))}
              />
              <Select
                id="manual-group"
                name="feeGroup"
                label="Группа платы"
                defaultValue="mount"
                options={FEE_GROUPS.map(([value, label]) => ({ value, label }))}
              />
              <TextField id="manual-qty" name="qty" label="Количество" defaultValue="1" inputMode="numeric" />
              <TextField id="manual-sum" name="unitSum" label="Цена за штуку, сумов" inputMode="numeric" />
            </div>
            <label className="adm-check">
              <input type="checkbox" name="notPurchased" />
              Это работа исполнителя: ИП её не закупает из денег клиента
            </label>
          </ActionForm>
        </>
      ) : null}

      {canSend && quote ? (
        <>
          <h2>Отправить клиенту</h2>
          <ActionForm
            action={sendQuoteAction.bind(null, id, quote.id)}
            submit="Отправить смету клиенту"
            testId="send-quote"
            variant="primary"
            resetOnSuccess={false}
          >
            <label className="adm-check">
              <input type="checkbox" name="checked" />
              Проверено вручную: строки, цены, совместимость, срок
            </label>
            <p className="adm-note">После отправки смета не меняется; новая версия — через «Вернуть смету в работу».</p>
          </ActionForm>
        </>
      ) : null}
    </>
  );
}
