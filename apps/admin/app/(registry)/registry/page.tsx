import { sales } from "@nivel/db/repos";
import { threshold } from "@nivel/services";
import { Button, TextField } from "@nivel/ui/react";
import type { Metadata } from "next";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { canDo } from "../../../src/orders/access.ts";
import { addOtherIncomeAction } from "../../../src/orders/actions.ts";
import { formatDateTime, formatSum, tashkentDay } from "../../../src/orders/format.ts";
import { STATUS_LABEL } from "../../../src/orders/labels.ts";
import { requireOrdersUser } from "../../../src/orders/next.ts";
import { listOtherIncome, listRegistry, listRegistryYears } from "../../../src/orders/read-registry.ts";
import { servicesRuntime } from "../../../src/orders/runtime.ts";
import { ActionForm } from "../../../src/orders/ui/ActionForm.tsx";
import { Title } from "../../../src/orders/ui/OrdersShell.tsx";
import { ThresholdBlock } from "../../../src/orders/ui/ThresholdBlock.tsx";

export const metadata: Metadata = { title: "Порог и учёт" };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function RegistryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOrdersUser(["registry.read"]);
  const raw = await searchParams;
  const rt = servicesRuntime();
  const current = Number(tashkentDay(rt.now()).slice(0, 4));
  const asked = Number(first(raw.year));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : current;
  const { db } = getRuntime();
  const [status, rows, income, years, deals, warranty, taxRisk] = await Promise.all([
    threshold.status({ year }, rt),
    listRegistry(db, year),
    listOtherIncome(db, year),
    listRegistryYears(db, current),
    sales.dealVolume(db, year),
    sales.reserveBalance(db, "warranty"),
    sales.reserveBalance(db, "tax_risk"),
  ]);
  return (
    <>
      <Title
        title="Порог и учёт"
        lead="Сделки года против порога оборота, реестр «поступило = закуплено + возвращено» по заказам, доход другой деятельности ИП. Выгрузка — для бухгалтера."
      />
      <form className="adm-filters" method="get" action="/registry" data-testid="registry-year">
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="registry-year">
            Год
          </label>
          <span className="nv-select">
            <select className="nv-field__control" id="registry-year" name="year" defaultValue={String(year)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </span>
        </div>
        <Button type="submit" variant="ghost">
          Показать
        </Button>
        {canDo(user.role, "registry.export") ? (
          <a className="nv-btn nv-btn--ghost" href={`/registry/export?year=${year}`} data-testid="registry-export">
            Выгрузить CSV для бухгалтера
          </a>
        ) : null}
      </form>

      <ThresholdBlock status={status} />

      <section data-testid="deals" aria-labelledby="deals-title">
        <h2 id="deals-title">Из чего сложились сделки {year}</h2>
        <dl className="adm-kv">
          <dt>Чеки закупок</dt>
          <dd>{formatSum(deals.receiptsSum)}</dd>
          <dt>Получено платы</dt>
          <dd>{formatSum(deals.feeInSum)}</dd>
          <dt>Возвращено платы</dt>
          <dd>{formatSum(deals.feeRefundSum)}</dd>
          <dt>Доход другой деятельности ИП</dt>
          <dd data-testid="deals-other">{formatSum(deals.otherIncomeSum)}</dd>
          <dt>Всего сделок</dt>
          <dd data-testid="deals-total">{formatSum(deals.dealsSum)}</dd>
        </dl>
        <p className="adm-note">
          Возвращённые остатки денег на закупку сделкой не считаются. Резервы: гарантия {formatSum(warranty)}, налоговый
          риск {formatSum(taxRisk)}.
        </p>
      </section>

      <section data-testid="registry" aria-labelledby="registry-title">
        <h2 id="registry-title">Реестр по заказам</h2>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Статус</th>
                <th className="adm-num">Поступило</th>
                <th className="adm-num">Закуплено</th>
                <th className="adm-num">Возвращено</th>
                <th className="adm-num">Потери</th>
                <th className="adm-num">Расхождение</th>
                <th className="adm-num">Плата получена</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>В {year} году движения денег по заказам не было.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.orderId} data-testid="registry-row" data-number={r.number}>
                    <td>
                      <a href={`/orders/${r.orderId}`}>{r.number}</a>
                    </td>
                    <td>{STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status}</td>
                    <td className="adm-num">{formatSum(r.received)}</td>
                    <td className="adm-num">{formatSum(r.purchased)}</td>
                    <td className="adm-num">{formatSum(r.returned)}</td>
                    <td className="adm-num">{formatSum(r.losses)}</td>
                    <td className={r.difference === 0 ? "adm-num" : "adm-num ord-late"} data-testid="registry-diff">
                      {formatSum(r.difference)}
                    </td>
                    <td className="adm-num">{formatSum(r.feeIn)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="adm-note">
          Расхождение — то, что клиенту ещё предстоит вернуть (поступило − закуплено − возвращено − потери с
          документами). У закрытого заказа оно равно нулю.
        </p>
      </section>

      <section data-testid="other-income" aria-labelledby="income-title">
        <h2 id="income-title">Доход другой деятельности ИП</h2>
        <p className="adm-note">Входит в сделки года и в порог (НК, ст. 462). Вносится по месяцам.</p>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th className="adm-num">Сумма</th>
                <th>Примечание</th>
                <th>Внесён</th>
              </tr>
            </thead>
            <tbody>
              {income.length === 0 ? (
                <tr>
                  <td colSpan={4}>Записей нет.</td>
                </tr>
              ) : (
                income.map((i) => (
                  <tr key={i.id}>
                    <td>{i.period}</td>
                    <td className="adm-num">{formatSum(i.amountSum)}</td>
                    <td>{i.note ?? "—"}</td>
                    <td>{formatDateTime(i.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {canDo(user.role, "registry.write") ? (
          <ActionForm action={addOtherIncomeAction} submit="Внести доход" testId="income-form" variant="primary">
            <div className="adm-grid">
              <TextField id="income-period" name="period" label="Месяц (ГГГГ-ММ)" placeholder={`${year}-10`} />
              <TextField id="income-sum" name="amountSum" label="Сумма, сумов" inputMode="numeric" />
              <TextField
                id="income-sum-again"
                name="amountAgain"
                label="Сумма ещё раз"
                inputMode="numeric"
                hint="Запись о доходе нельзя убрать: введите сумму повторно."
              />
              <TextField id="income-note" name="note" label="Примечание" />
            </div>
          </ActionForm>
        ) : null}
      </section>
    </>
  );
}
