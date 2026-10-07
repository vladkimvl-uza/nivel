// The estimate of the order: the totals the server calculated and stored, the lines, the compatibility verdict. The
// editor itself is its own page (QuoteEditor.tsx); here it is read only.
import { formatBp, formatDateTime, formatSum } from "../format.ts";
import { QUOTE_STATUS_LABEL, VERDICT_LABEL } from "../labels.ts";
import type { OrderCard, QuoteView } from "../read-orders.ts";

const ELIGIBILITY: Record<string, string> = {
  full_cycle: "полный цикл",
  free_window_only: "только при свободном окне",
  podbor_only: "только «Подбор»",
  setup_below_min: "сетап ниже минимума",
};

const WARNING_TEXT: Record<string, string> = {
  "quote.price_uncertain": "Цена позиции ненадёжна: медианы нет или доверие низкое. Проверьте её вручную.",
  "quote.demo_data": "В смете демонстрационные данные: клиенту такую смету отправлять нельзя.",
};

export function QuoteTotals({ quote }: { quote: QuoteView }) {
  const t = quote.totals;
  return (
    <dl className="adm-kv" data-testid="quote-totals">
      <dt>Версия</dt>
      <dd>
        {quote.version} · {QUOTE_STATUS_LABEL[quote.status] ?? quote.status}
        {quote.watermarkDraft ? " · с пометкой «не оферта»" : ""}
      </dd>
      <dt>Совместимость</dt>
      <dd data-testid="quote-verdict" data-verdict={quote.compatVerdict}>
        {VERDICT_LABEL[quote.compatVerdict] ?? quote.compatVerdict}
      </dd>
      <dt>Допуск</dt>
      <dd>
        {ELIGIBILITY[t.eligibility] ?? t.eligibility}
        {t.minEstimate !== null ? ` (от ${formatSum(t.minEstimate)})` : ""}
      </dd>
      <dt>Детали по смете</dt>
      <dd>{formatSum(t.componentsSum)}</dd>
      {t.outsideScaleSum > 0 ? (
        <>
          <dt>Вне шкалы платы</dt>
          <dd>{formatSum(t.outsideScaleSum)}</dd>
        </>
      ) : null}
      <dt>Резерв ({formatBp(t.reserveBp)})</dt>
      <dd>{formatSum(t.reserveSum)}</dd>
      <dt>Лимит закупки</dt>
      <dd data-testid="quote-limit">{formatSum(t.purchaseLimit)}</dd>
      <dt>Плата{t.effectiveRateBp !== null ? ` (${formatBp(t.effectiveRateBp)})` : ""}</dt>
      <dd data-testid="quote-fee">{formatSum(t.feeTotal)}</dd>
      <dt>— вознаграждение за закупку и ручательство</dt>
      <dd>{formatSum(t.feeCommissionLine)}</dd>
      <dt>— работы</dt>
      <dd>{formatSum(t.feeWorksLine)}</dd>
      <dt>Аванс при принятии</dt>
      <dd>{formatSum(t.advance)}</dd>
      <dt>Остаток платы при выдаче</dt>
      <dd>{formatSum(t.final)}</dd>
      <dt>Итого клиенту</dt>
      <dd data-testid="quote-grand">{formatSum(t.grandTotal)}</dd>
      <dt>Срок сметы</dt>
      <dd>
        {quote.validUntil
          ? `до ${formatDateTime(quote.validUntil)}`
          : quote.shelfLifeHours
            ? `${quote.shelfLifeHours} ч от отправки`
            : "—"}
      </dd>
      {quote.manuallyCheckedAt ? (
        <>
          <dt>Проверено вручную</dt>
          <dd>{formatDateTime(quote.manuallyCheckedAt)}</dd>
        </>
      ) : null}
      <dt>Версия шкалы платы</dt>
      <dd>{quote.settingsVersion}</dd>
    </dl>
  );
}

export function QuoteLines({ quote }: { quote: QuoteView }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table" data-testid="quote-lines">
        <thead>
          <tr>
            <th>Позиция</th>
            <th>Категория</th>
            <th className="adm-num">Кол-во</th>
            <th className="adm-num">Цена</th>
            <th>Цена на дату</th>
            <th>Закупает</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.length === 0 ? (
            <tr>
              <td colSpan={6}>В смете нет строк.</td>
            </tr>
          ) : (
            quote.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.title}</td>
                <td>{l.categoryCode}</td>
                <td className="adm-num">{l.qty}</td>
                <td className="adm-num">{formatSum(l.unitSum)}</td>
                <td>
                  {l.priceDate
                    ? `${l.priceDate.split("-").reverse().join(".")} · доверие: ${l.confidence ?? "—"}`
                    : "вручную"}
                </td>
                <td>
                  {l.customerOwned
                    ? "свои детали клиента"
                    : l.purchasedByIp
                      ? "ИП из денег клиента"
                      : "работа исполнителя"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function QuoteWarnings({ quote }: { quote: QuoteView }) {
  if (quote.totals.warnings.length === 0) return null;
  return (
    <ul className="adm-note" data-testid="quote-warnings">
      {quote.totals.warnings.map((w, i) => (
        // The same key can come twice with another position: the order of the list is stable.
        <li key={`${w.key}-${i}`}>{WARNING_TEXT[w.key] ?? "Предупреждение расчёта: проверьте смету."}</li>
      ))}
    </ul>
  );
}

export function QuoteBlock({ card, canEdit }: { card: OrderCard; canEdit: boolean }) {
  const quote = card.quote;
  return (
    <section data-testid="quote" aria-labelledby="quote-title">
      <h2 id="quote-title">Смета</h2>
      {quote ? (
        <>
          <QuoteTotals quote={quote} />
          <QuoteWarnings quote={quote} />
          <QuoteLines quote={quote} />
        </>
      ) : (
        <p className="adm-note">Сметы ещё нет.</p>
      )}
      {canEdit ? (
        <p>
          <a
            className="nv-btn nv-btn--ghost nv-btn--sm"
            href={`/orders/${card.order.id}/quote`}
            data-testid="open-quote-editor"
          >
            {quote ? "Открыть редактор сметы" : "Составить смету"}
          </a>
        </p>
      ) : null}
    </section>
  );
}
