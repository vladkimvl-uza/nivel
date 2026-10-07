// The head of the card: who the order is for, where it stands, the terms the automaton stored; and the money block with
// the indicator "spent / limit / received" of the purchases. Stored values only, nothing is added up here.
import { Badge } from "@nivel/ui/react";
import { formatDateTime, formatSum } from "../format.ts";
import { KIND_LABEL, STATUS_LABEL } from "../labels.ts";
import type { OrderCard } from "../read-orders.ts";

export function CardHeader({ card }: { card: OrderCard }) {
  const { order, customer } = card;
  const offerOpen = card.offer.uz !== "published" || card.offer.ru !== "published";
  return (
    <header data-testid="order-head">
      <p className="adm-crumbs">
        <a href="/orders">Заказы</a>
        <span>{order.number}</span>
      </p>
      <h1>
        {order.number} · {customer.displayName}
      </h1>
      <p>
        <span className="nv-tag" data-testid="order-status" data-status={order.status}>
          {STATUS_LABEL[order.status]}
        </span>{" "}
        {offerOpen ? <Badge kind="draft" label="оферта: заглушка" /> : null}
      </p>
      <dl className="adm-kv">
        <dt>Вид</dt>
        <dd>{KIND_LABEL[order.kind] ?? order.kind}</dd>
        <dt>Клиент</dt>
        <dd>
          {customer.displayName}
          {customer.telegramUsername ? ` · @${customer.telegramUsername}` : ""}
          {customer.phone ? ` · ${customer.phone}` : ""}
          {customer.district ? ` · ${customer.district}` : ""}
          {customer.erased ? " · обезличен" : ""}
        </dd>
        {card.leadNumber ? (
          <>
            <dt>Заявка</dt>
            <dd>{card.leadNumber}</dd>
          </>
        ) : null}
        <dt>Создан</dt>
        <dd>{formatDateTime(order.createdAt)}</dd>
        {order.acceptedAt ? (
          <>
            <dt>Принят клиентом</dt>
            <dd>{formatDateTime(order.acceptedAt)}</dd>
          </>
        ) : null}
        {order.purchaseNotBefore ? (
          <>
            <dt>Закупка не раньше</dt>
            <dd>{formatDateTime(order.purchaseNotBefore)}</dd>
          </>
        ) : null}
        {order.reportDueAt ? (
          <>
            <dt>Отчёт к сдаче</dt>
            <dd>{formatDateTime(order.reportDueAt)}</dd>
          </>
        ) : null}
        {order.objectionUntil ? (
          <>
            <dt>Возражения до</dt>
            <dd>{formatDateTime(order.objectionUntil)}</dd>
          </>
        ) : null}
        {order.refundDueAt ? (
          <>
            <dt>Возврат до</dt>
            <dd>{formatDateTime(order.refundDueAt)}</dd>
          </>
        ) : null}
        {order.warrantyUntil ? (
          <>
            <dt>Гарантия до</dt>
            <dd>{formatDateTime(order.warrantyUntil)}</dd>
          </>
        ) : null}
        <dt>Флаги</dt>
        <dd>
          аванс {order.feePrepaid ? "получен" : "не получен"} · деньги на закупку{" "}
          {order.fundsReceived ? "получены" : "не получены"} · встреча{" "}
          {order.firstOrderMeetingDone ? "была" : "не отмечена"}
        </dd>
      </dl>
    </header>
  );
}

export function MoneyBlock({ card }: { card: OrderCard }) {
  const { money, quote } = card;
  const limit = quote?.totals.purchaseLimit ?? null;
  return (
    <section data-testid="money" aria-labelledby="money-title">
      <h2 id="money-title">Деньги по закупке</h2>
      <dl className="adm-kv">
        <dt>Поступило от клиента</dt>
        <dd data-testid="money-received">{formatSum(money.fundsReceived)}</dd>
        <dt>Закуплено по чекам</dt>
        <dd data-testid="money-spent">{formatSum(money.receiptsTotal)}</dd>
        <dt>Возвращено клиенту</dt>
        <dd data-testid="money-returned">{formatSum(money.refunded)}</dd>
        {money.documentedLosses > 0 ? (
          <>
            <dt>Потери с документами</dt>
            <dd>{formatSum(money.documentedLosses)}</dd>
          </>
        ) : null}
        <dt>Лимит закупки по смете</dt>
        <dd data-testid="money-limit">{formatSum(limit)}</dd>
        <dt>Согласие на превышение лимита</dt>
        <dd>{money.hasLimitOverrunConsent ? "есть" : "нет"}</dd>
      </dl>
      {limit !== null && limit > 0 ? (
        <p className="adm-note" data-testid="spend-meter">
          Потрачено / лимит:{" "}
          <meter
            min={0}
            max={limit}
            value={Math.min(money.receiptsTotal, limit)}
            aria-label="Потрачено от лимита закупки"
          >
            {formatSum(money.receiptsTotal)}
          </meter>{" "}
          {formatSum(money.receiptsTotal)} из {formatSum(limit)}; получено {formatSum(money.fundsReceived)}
        </p>
      ) : null}
      <p className="adm-note">
        Заказ закрывается, когда поступило = закуплено + возвращено. Закрытие выполняет система после сдачи и сверки.
      </p>
    </section>
  );
}
