// The deals of the year against the registration threshold of the VAT payer (NK art. 462 part 9): the status is the one
// `thresholdStatus` of the domain counted, through `services.threshold.status`; the screen only draws it.
import type { ThresholdStatus } from "@nivel/domain/threshold";
import { formatBp, formatSum } from "../format.ts";

export function ThresholdBlock({ status, compact = false }: { status: ThresholdStatus; compact?: boolean }) {
  const alerts = status.crossedAlerts;
  return (
    <section data-testid="threshold" aria-labelledby="threshold-title">
      <h2 id="threshold-title">Порог оборота, {status.year}</h2>
      <dl className="adm-kv">
        <dt>Сделки года</dt>
        <dd data-testid="threshold-volume">{formatSum(status.volume)}</dd>
        <dt>Порог на год</dt>
        <dd data-testid="threshold-limit">{formatSum(status.limit)}</dd>
        <dt>Доля порога</dt>
        <dd data-testid="threshold-share">{formatBp(status.shareBp)}</dd>
        <dt>Осталось до порога</dt>
        <dd>{formatSum(status.remaining)}</dd>
        {compact ? null : (
          <>
            <dt>Принятые сметы без закупки</dt>
            <dd>{formatSum(status.committed)}</dd>
            <dt>Доля с учётом принятых смет</dt>
            <dd data-testid="threshold-projected">{formatBp(status.projectedShareBp)}</dd>
          </>
        )}
        <dt>Пройденные оповещения</dt>
        <dd data-testid="threshold-alerts">
          {alerts.length === 0 ? "нет" : alerts.map((a) => formatBp(a)).join(", ")}
        </dd>
        <dt>План года</dt>
        <dd className={status.overPlanCap ? "ord-late" : undefined}>
          {status.overPlanCap ? "прогноз выше плана: крупные заказы лучше отложить на январь" : "в пределах"}
        </dd>
      </dl>
    </section>
  );
}
