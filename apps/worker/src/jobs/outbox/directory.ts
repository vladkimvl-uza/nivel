// The addresses of the messages, read from the database with the rights of nivel_worker: the language and the Telegram id of a
// customer (columns the worker may read; the phone and the address are not asked for), the topic of an order, the group of the
// owner. A payload names none of these for real (outbox/contract.ts).
import type { Db } from "@nivel/db";
import { loadOwnerGroup } from "../../queues/settings.ts";
import type { ChatDirectory } from "./relay.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPgDirectory(db: Db): ChatDirectory {
  const q = db.$client;
  return {
    async customer(customerId) {
      if (!UUID.test(customerId)) return { skip: "the customer id is not valid" };
      const { rows } = await q.query<{ tg: string | null; lang: "uz" | "ru"; erased: boolean }>(
        "select telegram_user_id::text as tg, lang, erased_at is not null as erased from sales.customers where id = $1",
        [customerId],
      );
      const row = rows[0];
      if (!row) return { skip: "the customer is not known" };
      if (row.erased) return { skip: "the customer is erased" };
      if (row.tg === null) return { skip: "the customer has no Telegram id" };
      return { chatId: Number(row.tg), lang: row.lang };
    },

    ownerGroup: () => loadOwnerGroup(db),

    async topic(ref) {
      // An order has the topic of its own; a request that is not an order yet has the one of the request.
      if (ref.orderId !== undefined && UUID.test(ref.orderId)) {
        const { rows } = await q.query<{ topic: string | null }>(
          "select tg_topic_id::text as topic from sales.orders where id = $1",
          [ref.orderId],
        );
        const topic = rows[0]?.topic;
        if (topic !== null && topic !== undefined) return Number(topic);
      }
      if (ref.leadId !== undefined && UUID.test(ref.leadId)) {
        const { rows } = await q.query<{ topic: string | null }>(
          "select tg_topic_id::text as topic from sales.leads where id = $1",
          [ref.leadId],
        );
        const topic = rows[0]?.topic;
        if (topic !== null && topic !== undefined) return Number(topic);
      }
      return null;
    },
  };
}
