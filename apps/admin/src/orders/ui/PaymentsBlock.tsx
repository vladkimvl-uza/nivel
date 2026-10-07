// Payments of the order by kind, with the number of the receipt. Money is the owner's: the assistant sees the table and
// no button (the actions are not drawn for him, and the commands refuse him again).
import { Select, TextField } from "@nivel/ui/react";
import { confirmPaymentAction, expectPaymentAction, reversePaymentAction, voidPaymentAction } from "../actions.ts";
import { formatDateTime, formatSum } from "../format.ts";
import { METHOD_LABEL, PAYMENT_KIND_LABEL, PAYMENT_STATUS_LABEL } from "../labels.ts";
import type { OrderCard, PaymentView } from "../read-orders.ts";
import { ActionForm } from "./ActionForm.tsx";
import { PhotoPicker } from "./PhotoPicker.tsx";

const FEE_KINDS = ["fee_advance", "fee_final", "fee_extra", "podbor_fee"];

function ConfirmForm({ orderId, payment }: { orderId: string; payment: PaymentView }) {
  const fee = FEE_KINDS.includes(payment.kind);
  return (
    <ActionForm
      action={confirmPaymentAction.bind(null, orderId)}
      submit="Подтвердить платёж"
      testId={`confirm-${payment.id}`}
      variant="primary"
    >
      <input type="hidden" name="paymentId" value={payment.id} />
      {fee ? (
        <TextField
          id={`receipt-${payment.id}`}
          name="fiscalReceiptNo"
          label="Номер фискального чека"
          hint="Плата принимается только через QR Xolis с чеком кассы."
          required
        />
      ) : (
        <TextField
          id={`bankdoc-${payment.id}`}
          name="bankDocNo"
          label="Номер платёжного документа банка"
          hint={
            payment.direction === "in"
              ? "Деньги на закупку приходят только переводом на счёт ИП."
              : "Возврат клиенту — исходящий перевод."
          }
        />
      )}
      {payment.direction === "in" ? (
        <details>
          <summary>Платит не клиент</summary>
          <label className="adm-check">
            <input type="checkbox" name="payerOther" />
            Плательщик — другой человек (нужно его письменное заявление)
          </label>
          <PhotoPicker
            name="statementFileId"
            kind="third_party_statement"
            endpoint="/orders/upload"
            label="Фото заявления плательщика"
          />
        </details>
      ) : null}
    </ActionForm>
  );
}

function PaymentRows({ card, canWrite }: { card: OrderCard; canWrite: boolean }) {
  if (card.payments.length === 0) {
    return (
      <tr>
        <td colSpan={canWrite ? 7 : 6}>Платежей нет.</td>
      </tr>
    );
  }
  return card.payments.map((p) => (
    <tr key={p.id} data-testid={`payment-${p.kind}`} data-status={p.status}>
      <td>{PAYMENT_KIND_LABEL[p.kind] ?? p.kind}</td>
      <td>{METHOD_LABEL[p.method] ?? p.method}</td>
      <td className="adm-num">{formatSum(p.amountSum)}</td>
      <td>
        {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
        {p.reversalOf ? " · сторно" : ""}
      </td>
      <td>{p.fiscalReceiptNo ?? p.bankDocNo ?? "—"}</td>
      <td>
        {p.confirmedAt ? formatDateTime(p.confirmedAt) : "—"}
        {p.payerIsCustomer ? "" : " · плательщик не клиент"}
      </td>
      {canWrite ? (
        <td>
          {p.status === "expected" ? (
            <details>
              <summary>Подтвердить или аннулировать</summary>
              <ConfirmForm orderId={card.order.id} payment={p} />
              <ActionForm
                action={voidPaymentAction.bind(null, card.order.id)}
                submit="Аннулировать"
                testId={`void-${p.id}`}
              >
                <input type="hidden" name="paymentId" value={p.id} />
                <TextField id={`void-reason-${p.id}`} name="reason" label="Причина аннулирования" required />
              </ActionForm>
            </details>
          ) : null}
          {p.status === "confirmed" && p.reversalOf === null ? (
            <details>
              <summary>Исправить сторно</summary>
              <ActionForm
                action={reversePaymentAction.bind(null, card.order.id)}
                submit="Записать сторно"
                testId={`reverse-${p.id}`}
              >
                <input type="hidden" name="paymentId" value={p.id} />
                <TextField id={`reverse-reason-${p.id}`} name="reason" label="Причина исправления" required />
                <TextField
                  id={`reverse-sum-${p.id}`}
                  name="amountSum"
                  label="Сумма исправления"
                  inputMode="numeric"
                  hint="Пусто — платёж целиком."
                />
                {FEE_KINDS.includes(p.kind) ? (
                  <TextField id={`reverse-receipt-${p.id}`} name="fiscalReceiptNo" label="Номер чека возврата" />
                ) : (
                  <TextField id={`reverse-bank-${p.id}`} name="bankDocNo" label="Номер платёжного документа" />
                )}
              </ActionForm>
            </details>
          ) : null}
        </td>
      ) : null}
    </tr>
  ));
}

export function PaymentsBlock({ card, canWrite }: { card: OrderCard; canWrite: boolean }) {
  const id = card.order.id;
  return (
    <section data-testid="payments" aria-labelledby="payments-title">
      <h2 id="payments-title">Платежи</h2>
      <p className="adm-note">
        Два потока денег не смешиваются: плата — через QR Xolis с номером чека; деньги на закупку — только переводом на
        счёт ИП.
      </p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Вид</th>
              <th>Способ</th>
              <th className="adm-num">Сумма</th>
              <th>Состояние</th>
              <th>Номер чека или документа</th>
              <th>Когда</th>
              {canWrite ? <th>Действия</th> : null}
            </tr>
          </thead>
          <tbody>
            <PaymentRows card={card} canWrite={canWrite} />
          </tbody>
        </table>
      </div>
      {canWrite ? (
        <details className="adm-card" data-testid="expect-details">
          <summary>Ожидать платёж</summary>
          <ActionForm action={expectPaymentAction.bind(null, id)} submit="Поставить ожидание" testId="expect-payment">
            <Select
              id="expect-kind"
              name="kind"
              label="Вид платежа"
              defaultValue="fee_advance"
              options={Object.entries(PAYMENT_KIND_LABEL).map(([value, label]) => ({ value, label }))}
              hint="Сумма аванса, окончательной платы, денег на закупку и «Подбора» берётся из сметы."
            />
            <Select
              id="expect-method"
              name="method"
              label="Способ"
              defaultValue=""
              options={[
                { value: "", label: "Обычный для этого вида" },
                ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
            <TextField
              id="expect-amount"
              name="amountSum"
              label="Сумма, сумов"
              inputMode="numeric"
              hint="Только для видов без суммы в смете: доплата, возвраты, пополнение."
            />
          </ActionForm>
        </details>
      ) : null}
    </section>
  );
}
