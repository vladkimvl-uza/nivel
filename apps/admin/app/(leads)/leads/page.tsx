import { Button } from "@nivel/ui/react";
import type { Metadata } from "next";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { bindLeadAction, convertLeadAction } from "../../../src/orders/actions.ts";
import { formatDateTime } from "../../../src/orders/format.ts";
import { CHANNEL_LABEL, LEAD_STATUS_LABEL, SCOPE_LABEL } from "../../../src/orders/labels.ts";
import { requireOrdersUser } from "../../../src/orders/next.ts";
import { type LeadRow, listLeads, searchCustomers } from "../../../src/orders/read-leads.ts";
import { ActionForm } from "../../../src/orders/ui/ActionForm.tsx";
import { Title } from "../../../src/orders/ui/OrdersShell.tsx";

export const metadata: Metadata = { title: "Заявки" };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const BAND: Record<string, string> = {
  lt_6_7m: "до 6,7 млн",
  "6_7m_12m": "6,7–12 млн",
  "12m_20m": "12–20 млн",
  "20m_35m": "20–35 млн",
  gte_35m: "от 35 млн",
};

function Contact({ lead }: { lead: LeadRow }) {
  if (lead.customerId) {
    return (
      <>
        {lead.customerName ?? "Без имени"}
        {lead.customerUsername ? ` · @${lead.customerUsername}` : ""}
      </>
    );
  }
  return (
    <>
      <span className="nv-tag">клиент не привязан</span> {lead.contactName ?? "без имени"}
      {lead.contactUsername ? ` · @${lead.contactUsername}` : ""}
      {lead.contactPhone ? ` · ${lead.contactPhone}` : ""}
    </>
  );
}

function Actions({ lead }: { lead: LeadRow }) {
  if (lead.orderId) return <a href={`/orders/${lead.orderId}`}>{lead.orderNumber}</a>;
  const open = lead.status === "new" || lead.status === "in_review";
  if (!open) return null;
  if (lead.customerId === null) {
    return (
      <a className="nv-btn nv-btn--ghost nv-btn--sm" href={`/leads?bind=${lead.id}#bind`} data-testid="bind-open">
        Привязать к клиенту
      </a>
    );
  }
  return (
    <ActionForm
      action={convertLeadAction.bind(null, lead.id)}
      submit="Взять в работу"
      testId={`convert-${lead.number}`}
      variant="primary"
      className="adm-inline"
      resetOnSuccess={false}
    />
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOrdersUser(["leads.work"]);
  const raw = await searchParams;
  const status = first(raw.status);
  const bind = first(raw.bind);
  const cq = first(raw.cq) ?? "";
  const { db } = getRuntime();
  const seePhone = user.role === "owner";
  const leads = await listLeads(db, status ? { status } : {}, { seePhone });
  const candidates = bind && cq ? await searchCustomers(db, cq, { seePhone }) : [];
  return (
    <>
      <Title
        title="Заявки"
        lead="Заявки с сайта и из бота. Заявку сайта без клиента привязывают к клиенту вручную: сайт не знает, кому принадлежит телефон."
      />
      <form className="adm-filters" method="get" action="/leads" data-testid="lead-filters">
        <div className="nv-field">
          <label className="nv-field__label" htmlFor="lead-status">
            Состояние
          </label>
          <span className="nv-select">
            <select className="nv-field__control" id="lead-status" name="status" defaultValue={status ?? ""}>
              <option value="">Все</option>
              {Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <Button type="submit" variant="ghost">
          Показать
        </Button>
      </form>
      <div className="adm-table-wrap">
        <table className="adm-table" data-testid="leads-table">
          <thead>
            <tr>
              <th>Заявка</th>
              <th>Клиент</th>
              <th>Что нужно</th>
              <th>Пришла</th>
              <th>Состояние</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={6}>Заявок нет.</td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={l.id} data-testid="lead-row" data-lead={l.number} data-status={l.status}>
                  <td>{l.number}</td>
                  <td>
                    <Contact lead={l} />
                  </td>
                  <td>
                    {SCOPE_LABEL[l.scope] ?? l.scope} · {CHANNEL_LABEL[l.channel] ?? l.channel}
                    {l.budgetBand ? ` · бюджет ${BAND[l.budgetBand] ?? l.budgetBand}` : ""}
                    {l.district ? ` · ${l.district}` : ""}
                    {l.comment ? ` · «${l.comment}»` : ""}
                  </td>
                  <td>{formatDateTime(l.createdAt)}</td>
                  <td>{LEAD_STATUS_LABEL[l.status] ?? l.status}</td>
                  <td>
                    <Actions lead={l} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {bind ? (
        <section id="bind" data-testid="bind-section" aria-labelledby="bind-title">
          <h2 id="bind-title">Привязать заявку к клиенту</h2>
          <form className="adm-filters" method="get" action="/leads" data-testid="customer-search">
            <input type="hidden" name="bind" value={bind} />
            <div className="nv-field">
              <label className="nv-field__label" htmlFor="customer-q">
                Имя, Telegram или телефон клиента
              </label>
              <input className="nv-field__control" id="customer-q" name="cq" defaultValue={cq} />
            </div>
            <Button type="submit" variant="ghost">
              Найти
            </Button>
          </form>
          {cq && candidates.length === 0 ? (
            <p className="adm-note">Клиентов не найдено (поиск от двух знаков).</p>
          ) : null}
          {candidates.length > 0 ? (
            <div className="adm-table-wrap">
              <table className="adm-table" data-testid="customer-results">
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        {c.username ? ` · @${c.username}` : ""}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </td>
                      <td>
                        <ActionForm
                          action={bindLeadAction.bind(null, bind)}
                          submit="Привязать"
                          testId={`bind-${c.id}`}
                          className="adm-inline"
                          resetOnSuccess={false}
                        >
                          <input type="hidden" name="customerId" value={c.id} />
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
