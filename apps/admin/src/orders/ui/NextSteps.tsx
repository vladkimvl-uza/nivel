// "Next steps" of the card: only the buttons the automaton gives this role in this status (events.ts reads the table of the
// domain). Each is a form that calls the server action; the services decide again, and a refusal is shown as text.
import { TextField } from "@nivel/ui/react";
import type { Role } from "../../auth/roles.ts";
import { runEventAction } from "../actions.ts";
import { actionsFor, type EventAction } from "../events.ts";
import { formatDateTime, formatSum, toTashkentLocal } from "../format.ts";
import { ACT_KIND_LABEL, PAYMENT_KIND_LABEL, WAITING_FOR } from "../labels.ts";
import type { OrderCard, PaymentView } from "../read-orders.ts";
import { ActionForm } from "./ActionForm.tsx";

function confirmed(card: OrderCard, kinds: string[]): PaymentView[] {
  return card.payments.filter((p) => p.status === "confirmed" && p.reversalOf === null && kinds.includes(p.kind));
}

function PaymentSelect({
  id,
  name,
  label,
  payments,
}: {
  id: string;
  name: string;
  label: string;
  payments: PaymentView[];
}) {
  return (
    <div className="nv-field">
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="nv-select">
        <select className="nv-field__control" id={id} name={name} defaultValue={payments[0]?.id ?? ""}>
          {payments.length === 0 ? <option value="">Подтверждённых платежей нет</option> : null}
          {payments.map((p) => (
            <option key={p.id} value={p.id}>
              {PAYMENT_KIND_LABEL[p.kind] ?? p.kind} · {formatSum(p.amountSum)} ·{" "}
              {p.fiscalReceiptNo ?? p.bankDocNo ?? "без номера"}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

function StepForm({ card, action }: { card: OrderCard; action: EventAction }) {
  const id = card.order.id;
  const bound = runEventAction.bind(null, id, action.type);
  const testId = `event-${action.type}`;
  switch (action.type) {
    case "FEE_PREPAID":
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          <PaymentSelect
            id="prepaid-payment"
            name="paymentId"
            label="Платёж аванса"
            payments={confirmed(card, ["fee_advance"])}
          />
        </ActionForm>
      );
    case "FUNDS_RECEIVED": {
      const funds = confirmed(card, ["purchase_funds", "purchase_topup"]);
      const latest = funds
        .map((p) => p.confirmedAt)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          <fieldset className="adm-group">
            <legend>Переводы на счёт ИП</legend>
            {funds.length === 0 ? (
              <p className="adm-note">Подтверждённых переводов нет: подтвердите платёж ниже.</p>
            ) : null}
            {funds.map((p) => (
              <label key={p.id} className="adm-check">
                <input type="checkbox" name="paymentIds" value={p.id} defaultChecked />
                {formatSum(p.amountSum)} · {p.bankDocNo ?? "без номера"}
              </label>
            ))}
          </fieldset>
          <TextField
            id="funds-received-at"
            name="receivedAt"
            type="datetime-local"
            label="Когда деньги поступили на счёт (Ташкент)"
            defaultValue={latest ? toTashkentLocal(latest) : toTashkentLocal(new Date())}
            hint="Закупка начинается не раньше следующего рабочего дня после поступления."
          />
        </ActionForm>
      );
    }
    case "REMAINDER_SETTLED":
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          <div className="nv-field">
            <label className="nv-field__label" htmlFor="settle-refund">
              Платёж возврата остатка
            </label>
            <span className="nv-select">
              <select className="nv-field__control" id="settle-refund" name="refundPaymentId" defaultValue="">
                <option value="">Остатка нет или возврат не нужен</option>
                {confirmed(card, ["remainder_refund"]).map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatSum(p.amountSum)} · {p.bankDocNo ?? "без номера"}
                  </option>
                ))}
              </select>
            </span>
          </div>
        </ActionForm>
      );
    case "MATERIALS_ACCEPTED":
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          <ActSelect id="materials-act" card={card} kind="material_acceptance" />
        </ActionForm>
      );
    case "HANDOVER":
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          <ActSelect id="handover-act" card={card} kind="handover" name="actId" />
          <PaymentSelect
            id="handover-final"
            name="finalPaymentId"
            label="Окончательная плата (QR с чеком)"
            payments={confirmed(card, ["fee_final"])}
          />
        </ActionForm>
      );
    case "PODBOR_DELIVERED":
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          <PaymentSelect
            id="podbor-payment"
            name="paymentId"
            label="Плата за «Подбор»"
            payments={confirmed(card, ["podbor_fee"])}
          />
        </ActionForm>
      );
    case "CANCEL":
      return (
        <details className="adm-card">
          <summary>{action.label}</summary>
          <ActionForm action={bound} submit="Отменить заказ" testId={testId} resetOnSuccess={false}>
            <p className="adm-note">
              Расчёты с клиентом считает сервер по этапу заказа. Здесь только то, чего сервер знать не может.
            </p>
            <TextField id="cancel-reason" name="reason" label="Причина (по заявлению клиента)" required />
            <TextField
              id="cancel-assembly"
              name="assemblyDonePercent"
              label="Сборка выполнена на, %"
              inputMode="numeric"
              hint="Только если отмена во время сборки."
            />
            <TextField
              id="cancel-losses"
              name="documentedLosses"
              label="Потери с документами, сумов"
              inputMode="numeric"
              hint="Уменьшают возврат денег клиенту."
            />
          </ActionForm>
        </details>
      );
    default:
      return (
        <ActionForm action={bound} submit={action.label} testId={testId} variant="primary" resetOnSuccess={false}>
          {action.hint ? <p className="adm-note">{action.hint}</p> : null}
        </ActionForm>
      );
  }
}

function ActSelect({ id, card, kind, name = "actId" }: { id: string; card: OrderCard; kind: string; name?: string }) {
  const signed = card.acts.filter((a) => a.kind === kind && a.signedAt !== null);
  return (
    <div className="nv-field">
      <label className="nv-field__label" htmlFor={id}>
        {ACT_KIND_LABEL[kind] ?? "Акт"} (подписанный)
      </label>
      <span className="nv-select">
        <select className="nv-field__control" id={id} name={name} defaultValue={signed[0]?.id ?? ""}>
          {signed.length === 0 ? <option value="">Подписанных актов нет</option> : null}
          {signed.map((a) => (
            <option key={a.id} value={a.id}>
              {formatDateTime(a.signedAt)}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

const ELSEWHERE_LINK: Record<string, { href: (id: string) => string; label: string }> = {
  quote: { href: (id) => `/orders/${id}/quote`, label: "Открыть редактор сметы" },
  purchases: { href: () => "#purchases", label: "К закупкам" },
  report: { href: () => "#report", label: "К отчёту" },
};

export function NextSteps({ card, role }: { card: OrderCard; role: Role }) {
  const actions = actionsFor(card.order.status, role, card.order.kind);
  const waiting = WAITING_FOR[card.order.status];
  const forms = actions.filter((a) => a.ui !== "elsewhere");
  const links = actions.filter((a) => a.ui === "elsewhere");
  return (
    <section data-testid="next-steps" aria-labelledby="next-steps-title">
      <h2 id="next-steps-title">Следующие шаги</h2>
      {actions.length === 0 ? (
        <p className="adm-note" data-testid="no-steps">
          {role === "owner" || role === "assistant"
            ? (waiting ?? "Сейчас по этому заказу шагов нет.")
            : "У вашей роли нет действий по заказу."}
        </p>
      ) : null}
      {actions.length > 0 && waiting ? <p className="adm-note">{waiting}</p> : null}
      {links.length > 0 ? (
        <div className="adm-actions">
          {links.map((a) => {
            const link = a.section ? ELSEWHERE_LINK[a.section] : undefined;
            return link ? (
              <a
                key={a.type}
                className="nv-btn nv-btn--ghost nv-btn--sm"
                href={link.href(card.order.id)}
                data-testid={`step-${a.type}`}
              >
                {a.label}
              </a>
            ) : null;
          })}
        </div>
      ) : null}
      <div className="adm-cards">
        {forms.map((a) => (
          <div key={a.type} className="adm-card">
            {a.ui === "button" || a.type === "CANCEL" ? null : <h3>{a.label}</h3>}
            {a.hint && a.ui === "form" ? <p className="adm-note">{a.hint}</p> : null}
            <StepForm card={card} action={a} />
          </div>
        ))}
      </div>
    </section>
  );
}
