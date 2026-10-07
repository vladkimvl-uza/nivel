import { threshold } from "@nivel/services";
import type { Metadata } from "next";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { canDo } from "../../../src/orders/access.ts";
import { formatDate, formatDateTime, formatSum } from "../../../src/orders/format.ts";
import { PAYMENT_KIND_LABEL, SCOPE_LABEL, STATUS_LABEL } from "../../../src/orders/labels.ts";
import { requireOrdersUser } from "../../../src/orders/next.ts";
import { loadDashboard } from "../../../src/orders/read-dashboard.ts";
import { servicesRuntime } from "../../../src/orders/runtime.ts";
import { Title } from "../../../src/orders/ui/OrdersShell.tsx";
import { ThresholdBlock } from "../../../src/orders/ui/ThresholdBlock.tsx";

export const metadata: Metadata = { title: "Сводка" };
export const dynamic = "force-dynamic";

const WAIT = new Intl.NumberFormat("ru-RU");

function waited(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${WAIT.format(minutes)} мин`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${WAIT.format(hours)} ч` : `${WAIT.format(Math.floor(hours / 24))} сут`;
}

export default async function DashboardPage() {
  const user = await requireOrdersUser(["orders.read"]);
  const rt = servicesRuntime();
  const data = await loadDashboard(getRuntime().db, rt.now());
  // The threshold is the money of the whole business: the owner sees it, the assistant does not.
  const status = canDo(user.role, "registry.read") ? await threshold.status({}, rt) : null;
  const late = (v: boolean) => (v ? "ord-late" : undefined);
  return (
    <>
      <Title title="Сводка" lead="Что ждёт владельца сегодня: ответы, сроки, возвраты, подписи и порог." />
      <div className="adm-cards">
        <section className="adm-card" data-testid="dash-leads">
          <h2>Заявки без ответа</h2>
          {data.newLeads.length === 0 ? <p className="adm-note">Новых заявок нет.</p> : null}
          <ul>
            {data.newLeads.map((l) => (
              <li key={l.id}>
                <a href="/leads">{l.number}</a> · {SCOPE_LABEL[l.scope] ?? l.scope} · ждёт {waited(l.waitingMs)}
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card" data-testid="dash-estimates">
          <h2>Сметы с истекающим сроком</h2>
          {data.estimatesExpiring.length === 0 ? <p className="adm-note">Отправленных смет нет.</p> : null}
          <ul>
            {data.estimatesExpiring.map((e) => (
              <li key={e.orderId} className={late(e.expired)}>
                <a href={`/orders/${e.orderId}`}>{e.number}</a> · до {formatDateTime(e.validUntil)}
                {e.expired ? " · истекла" : ""}
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card" data-testid="dash-reports">
          <h2>Отчёты к сдаче</h2>
          {data.reportsDue.length === 0 ? <p className="adm-note">Отчётов к сдаче нет.</p> : null}
          <ul>
            {data.reportsDue.map((r) => (
              <li key={r.orderId} className={late(r.late)}>
                <a href={`/orders/${r.orderId}`}>{r.number}</a> · до {formatDateTime(r.dueAt)}
                {r.late ? " · просрочен" : ""}
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card" data-testid="dash-refunds">
          <h2>Возвраты клиентам</h2>
          {data.refundsDue.length === 0 ? <p className="adm-note">Ожидаемых возвратов нет.</p> : null}
          <ul>
            {data.refundsDue.map((r, i) => (
              <li key={`${r.orderId}-${r.kind}-${i}`} className={late(r.late)}>
                <a href={`/orders/${r.orderId}`}>{r.number}</a> · {PAYMENT_KIND_LABEL[r.kind] ?? r.kind} ·{" "}
                {formatSum(r.amountSum)} · до {formatDateTime(r.dueAt)}
                {r.late ? " · просрочен" : ""}
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card" data-testid="dash-esf">
          <h2>ЭСФ к подписи</h2>
          {data.esfPending.length === 0 ? <p className="adm-note">Неподписанных ЭСФ нет.</p> : null}
          <ul>
            {data.esfPending.map((e) => (
              <li key={e.purchaseId} className={late(e.late)}>
                <a href={`/orders/${e.orderId}`}>{e.orderNumber}</a> · {e.esfNo ?? "без номера"} · до{" "}
                {formatDate(e.due)}
                {e.late ? " · просрочена" : ""}
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card" data-testid="dash-warranty">
          <h2>Гарантийные сроки</h2>
          {data.warranty.length === 0 ? <p className="adm-note">Открытых гарантийных случаев нет.</p> : null}
          <ul>
            {data.warranty.map((w) => (
              <li key={w.id} className={late(w.late)}>
                <a href={`/orders/${w.orderId}`}>{w.number}</a> · ближайший срок {formatDateTime(w.nextDue)}
                {w.late ? " · просрочен" : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section data-testid="dash-active" aria-labelledby="active-title">
        <h2 id="active-title">Заказы в работе</h2>
        {data.active.length === 0 ? <p className="adm-note">Активных заказов нет.</p> : null}
        <ul>
          {data.active.map((a) => (
            <li key={a.status}>
              <a href={`/orders?status=${a.status}`}>{STATUS_LABEL[a.status]}</a>: {a.count}
            </li>
          ))}
        </ul>
      </section>
      {status ? <ThresholdBlock status={status} compact /> : null}
    </>
  );
}
