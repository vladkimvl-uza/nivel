// Purchases of the order: what was bought, with the receipts and their photos, the ESF with its term, the serial numbers
// and the warranty of the shop; and the form of a new purchase (the owner and the assistant). The limit and the money
// the customer sent are checked by the services; a refusal is shown in Russian.
import { Select, TextField } from "@nivel/ui/react";
import { recordConsentAction, recordPurchaseAction } from "../actions.ts";
import { formatDate, formatDateTime, formatSum } from "../format.ts";
import { CONSENT_LABEL } from "../labels.ts";
import type { OrderCard } from "../read-orders.ts";
import { ActionForm } from "./ActionForm.tsx";
import { PhotoPicker } from "./PhotoPicker.tsx";

const RECEIPT_KIND = { fiscal: "Фискальный чек", esf: "ЭСФ", none_with_consent: "Без чека, с согласием клиента" };
const ESF_STATUS = { pending: "ждёт подписи", signed: "подписана", rejected: "отклонена" } as const;
const PAID_VIA = { bank_transfer: "Перевод со счёта ИП", corp_card: "Карта ИП" };

export function PurchasesBlock({
  card,
  vendors,
  canRecord,
  canConsent,
}: {
  card: OrderCard;
  vendors: { id: string; name: string }[];
  canRecord: boolean;
  canConsent: boolean;
}) {
  const id = card.order.id;
  const open = card.order.status === "purchasing";
  return (
    <section id="purchases" data-testid="purchases" aria-labelledby="purchases-title">
      <h2 id="purchases-title">Закупки</h2>
      <div className="adm-table-wrap">
        <table className="adm-table" data-testid="purchases-table">
          <thead>
            <tr>
              <th>Магазин</th>
              <th className="adm-num">Кол-во</th>
              <th className="adm-num">Сумма</th>
              <th>Чек</th>
              <th>Фото</th>
              <th>Серийные номера</th>
              <th>Гарантия магазина</th>
              <th>Кто и когда</th>
            </tr>
          </thead>
          <tbody>
            {card.purchases.length === 0 ? (
              <tr>
                <td colSpan={8}>Покупок нет.</td>
              </tr>
            ) : (
              card.purchases.map((p) => (
                <tr key={p.id} data-testid="purchase-row">
                  <td>{p.vendorName}</td>
                  <td className="adm-num">{p.qty}</td>
                  <td className="adm-num">
                    {formatSum(p.amountSum)}
                    {p.discountSum > 0 ? ` (скидка ${formatSum(p.discountSum)})` : ""}
                  </td>
                  <td>
                    {RECEIPT_KIND[p.receiptKind as keyof typeof RECEIPT_KIND] ?? p.receiptKind}
                    {p.receiptNo ? ` № ${p.receiptNo}` : ""}
                    {p.esfNo ? ` № ${p.esfNo}` : ""}
                    {p.esfStatus ? `, ${ESF_STATUS[p.esfStatus as keyof typeof ESF_STATUS] ?? p.esfStatus}` : ""}
                    {p.esfDue && p.esfStatus === "pending" ? ` до ${formatDate(p.esfDue)}` : ""}
                  </td>
                  <td>
                    {p.files.length === 0
                      ? "—"
                      : p.files.map((f, i) => (
                          <a
                            key={f.id}
                            href={`/orders/files/${f.id}`}
                            target="_blank"
                            rel="noreferrer"
                            data-testid="receipt-photo"
                          >
                            {i > 0 ? ", " : ""}
                            фото
                          </a>
                        ))}
                  </td>
                  <td>{p.serials.length > 0 ? p.serials.join(", ") : "—"}</td>
                  <td>{p.vendorWarrantyUntil ? `до ${formatDate(p.vendorWarrantyUntil)}` : "—"}</td>
                  <td>
                    {p.boughtBy.slice(0, 8)} · {formatDateTime(p.boughtAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canConsent && open ? (
        <details className="adm-card" data-testid="consent-details">
          <summary>Согласие клиента на то, что двигает деньги</summary>
          <p className="adm-note">
            Записывайте, когда клиент сказал «да» в боте или по телефону. Согласие нужно, чтобы чеки вышли за лимит,
            чтобы купить без чека или заменить деталь.
          </p>
          {card.consents.filter((c) => c.kind in CONSENT_LABEL).length > 0 ? (
            <ul className="adm-note">
              {card.consents
                .filter((c) => c.kind in CONSENT_LABEL)
                .map((c) => (
                  <li key={c.kind}>
                    {CONSENT_LABEL[c.kind]}: {c.granted ? "есть" : "отозвано"} ({formatDateTime(c.at)})
                  </li>
                ))}
            </ul>
          ) : null}
          <ActionForm
            action={recordConsentAction.bind(null, id)}
            submit="Записать согласие клиента"
            testId="record-consent"
          >
            <Select
              id="consent-kind"
              name="kind"
              label="На что согласен клиент"
              defaultValue="limit_overrun"
              options={Object.entries(CONSENT_LABEL).map(([value, label]) => ({ value, label }))}
            />
            <TextField
              id="consent-note"
              name="note"
              label="Как и когда клиент согласился"
              hint="Например: «позвонил 12.10 в 15:20» или «написал в боте». Остаётся в записи согласия."
              maxLength={500}
            />
          </ActionForm>
        </details>
      ) : null}

      {canRecord && open ? (
        <div className="adm-card">
          <h3>Записать покупку</h3>
          <ActionForm
            action={recordPurchaseAction.bind(null, id)}
            submit="Записать покупку"
            testId="record-purchase"
            variant="primary"
          >
            <div className="adm-grid">
              <Select
                id="purchase-vendor"
                name="vendorId"
                label="Магазин"
                placeholder="Выберите магазин"
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
              <Select
                id="purchase-line"
                name="quoteLineId"
                label="Строка сметы"
                defaultValue=""
                options={[
                  { value: "", label: "Вне сметы" },
                  ...(card.quote?.lines ?? []).map((l) => ({ value: l.id, label: l.title })),
                ]}
              />
              <TextField id="purchase-qty" name="qty" label="Количество" inputMode="numeric" defaultValue="1" />
              <TextField id="purchase-amount" name="amountSum" label="Сумма по чеку, сумов" inputMode="numeric" />
              <TextField
                id="purchase-discount"
                name="discountSum"
                label="Скидка, сумов"
                inputMode="numeric"
                hint="Скидки и бонусы идут клиенту."
              />
              <Select
                id="purchase-paid"
                name="paidVia"
                label="Чем оплачено"
                defaultValue="bank_transfer"
                options={Object.entries(PAID_VIA).map(([value, label]) => ({ value, label }))}
              />
              <Select
                id="purchase-kind"
                name="receiptKind"
                label="Вид чека"
                defaultValue="fiscal"
                options={Object.entries(RECEIPT_KIND).map(([value, label]) => ({ value, label }))}
              />
              <TextField id="purchase-receipt" name="receiptNo" label="Номер чека" hint="Для фискального чека." />
              <TextField
                id="purchase-esf"
                name="esfNo"
                label="Номер ЭСФ"
                hint="Для ЭСФ; подпись — в течение 10 дней."
              />
              <Select
                id="purchase-esf-status"
                name="esfStatus"
                label="Состояние ЭСФ"
                defaultValue=""
                options={[
                  { value: "", label: "—" },
                  ...Object.entries(ESF_STATUS).map(([value, label]) => ({ value, label })),
                ]}
              />
              <TextField
                id="purchase-warranty"
                name="vendorWarrantyMonths"
                label="Гарантия магазина, месяцев"
                inputMode="numeric"
              />
            </div>
            <div className="nv-field">
              <label className="nv-field__label" htmlFor="purchase-serials">
                Серийные номера
              </label>
              <textarea
                id="purchase-serials"
                name="serials"
                className="nv-field__control adm-textarea"
                rows={3}
                placeholder="По одному в строке"
              />
            </div>
            <PhotoPicker
              name="receiptFileIds"
              kind="receipt"
              label="Фото чека или ЭСФ"
              multiple
              testId="receipt-picker"
            />
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}
