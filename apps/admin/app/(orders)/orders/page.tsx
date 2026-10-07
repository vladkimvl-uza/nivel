import type { OrderStatus } from "@nivel/domain/order";
import { Button } from "@nivel/ui/react";
import type { Metadata } from "next";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { STATUS_ORDER } from "../../../src/orders/events.ts";
import { formatDateTime, formatSum } from "../../../src/orders/format.ts";
import { KIND_LABEL, STATUS_LABEL } from "../../../src/orders/labels.ts";
import { requireOrdersUser } from "../../../src/orders/next.ts";
import { type BoardRow, listBoard } from "../../../src/orders/read-orders.ts";
import { Title } from "../../../src/orders/ui/OrdersShell.tsx";

export const metadata: Metadata = { title: "Заказы" };
export const dynamic = "force-dynamic";

/** The board by stages: the road of an order, from the estimate to the end; a stage holds the statuses that look alike. */
const STAGES: { title: string; statuses: OrderStatus[] }[] = [
  { title: "Смета", statuses: ["estimate_draft", "estimate_sent", "estimate_expired"] },
  { title: "Деньги", statuses: ["accepted"] },
  { title: "Закупка", statuses: ["purchasing", "report_due"] },
  { title: "Отчёт и расчёт", statuses: ["report_sent", "settled"] },
  { title: "Сборка и тест", statuses: ["assembling", "testing"] },
  { title: "Выдача", statuses: ["ready", "delivering"] },
  { title: "Передано", statuses: ["handed_over"] },
  { title: "Завершены", statuses: ["closed", "podbor_delivered", "cancelling", "cancelled"] },
];

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function Row({ r }: { r: BoardRow }) {
  return (
    <tr data-testid="board-row" data-status={r.status}>
      <td>
        <a href={`/orders/${r.id}`}>{r.number}</a>
      </td>
      <td>
        {r.customerName}
        {r.customerUsername ? ` · @${r.customerUsername}` : ""}
      </td>
      <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
      <td>{STATUS_LABEL[r.status]}</td>
      <td className="adm-num">{formatSum(r.purchaseLimit)}</td>
      <td className="adm-num">{formatSum(r.feeTotal)}</td>
      <td>{formatDateTime(r.updatedAt)}</td>
    </tr>
  );
}

export default async function OrdersBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrdersUser(["orders.read"]);
  const raw = await searchParams;
  const q = first(raw.q);
  const status = STATUS_ORDER.find((s) => s === first(raw.status));
  const rows = await listBoard(getRuntime().db, { ...(q ? { q } : {}), ...(status ? { status } : {}) });
  return (
    <>
      <Title
        title="Заказы"
        lead="Доска по этапам: от сметы до выдачи. Новый заказ появляется из заявки (раздел «Заявки»)."
      />
      <form className="adm-filters" method="get" action="/orders" data-testid="board-filters">
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="board-q">
            Номер или клиент
          </label>
          <input
            className="nv-field__control"
            id="board-q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="NV-2026 или имя"
          />
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="board-status">
            Статус
          </label>
          <span className="nv-select">
            <select className="nv-field__control" id="board-status" name="status" defaultValue={status ?? ""}>
              <option value="">Все</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </span>
        </div>
        <Button type="submit" variant="ghost">
          Показать
        </Button>
      </form>
      {rows.length === 0 ? <p className="adm-note">Заказов нет.</p> : null}
      <div className="ord-board" data-testid="board">
        {STAGES.map((stage) => {
          const inStage = rows.filter((r) => stage.statuses.includes(r.status));
          if (inStage.length === 0) return null;
          return (
            <details key={stage.title} className="ord-stage" open data-testid={`stage-${stage.statuses[0]}`}>
              <summary>
                <span>{stage.title}</span>
                <span className="ord-count">{inStage.length}</span>
              </summary>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Клиент</th>
                      <th>Вид</th>
                      <th>Статус</th>
                      <th className="adm-num">Лимит закупки</th>
                      <th className="adm-num">Плата</th>
                      <th>Изменён</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inStage.map((r) => (
                      <Row key={r.id} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
