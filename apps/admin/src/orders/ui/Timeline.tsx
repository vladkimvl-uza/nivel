// The chronology of the order: the journal of events the automaton wrote (sales.order_events), oldest first.
import { formatDateTime } from "../format.ts";
import { ACTOR_LABEL, EVENT_LABEL, STATUS_LABEL } from "../labels.ts";
import type { OrderCard } from "../read-orders.ts";

export function Timeline({ card }: { card: OrderCard }) {
  return (
    <section data-testid="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Хронология</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Когда (Ташкент)</th>
              <th>Кто</th>
              <th>Что произошло</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {card.events.length === 0 ? (
              <tr>
                <td colSpan={4}>Событий нет.</td>
              </tr>
            ) : (
              card.events.map((e) => {
                const type = String((e.event as { type?: unknown }).type);
                return (
                  <tr key={e.seq} data-event={type}>
                    <td className="adm-num">{formatDateTime(e.at)}</td>
                    <td>{ACTOR_LABEL[e.actorKind] ?? e.actorKind}</td>
                    <td>{EVENT_LABEL[type] ?? "Событие заказа"}</td>
                    <td>
                      {e.fromStatus === e.toStatus
                        ? STATUS_LABEL[e.toStatus]
                        : `${STATUS_LABEL[e.fromStatus]} → ${STATUS_LABEL[e.toStatus]}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
