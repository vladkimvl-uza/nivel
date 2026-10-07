// What the warranty jobs read with the rights of nivel_worker (SELECT on warranty cases, purchases and orders).
import type { Db } from "@nivel/db";
import type { SlaCase, VendorWarranty } from "./sla.ts";

export function createPgWarrantyReaders(
  db: Db,
): Pick<
  { openCases(): Promise<SlaCase[]>; vendorWarranties(today: string): Promise<VendorWarranty[]> },
  "openCases" | "vendorWarranties"
> {
  const q = db.$client;
  return {
    async openCases() {
      const { rows } = await q.query<{
        id: string;
        number: string;
        order_id: string;
        order_number: string;
        status: SlaCase["status"];
        due_reply: Date | null;
        due_diagnosis: Date | null;
        due_fix: Date | null;
      }>(
        `select c.id, c.number, c.order_id, o.number as order_number, c.status, c.due_reply, c.due_diagnosis, c.due_fix
           from sales.warranty_cases c join sales.orders o on o.id = c.order_id
          where c.status in ('opened', 'diagnosing', 'loaner_issued', 'at_supplier')
          order by c.opened_at
          limit 500`,
      );
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        orderId: r.order_id,
        orderNumber: r.order_number,
        status: r.status,
        dueReply: r.due_reply,
        dueDiagnosis: r.due_diagnosis,
        dueFix: r.due_fix,
      }));
    },

    /** Purchases (not returns) whose warranty of the shop ends from today to 30 days ahead, of orders that were handed over. */
    async vendorWarranties(today) {
      const { rows } = await q.query<{ id: string; order_id: string; order_number: string; until: string }>(
        `select p.id, p.order_id, o.number as order_number, p.vendor_warranty_until::text as until
           from sales.purchases p join sales.orders o on o.id = p.order_id
          where p.refund_of is null and p.amount_sum > 0
            and p.vendor_warranty_until between $1::date and $1::date + 30
            and o.status in ('handed_over', 'closed')
            and not exists (select 1 from ops.outbox b
                             where b.dedupe_key = 'order:' || p.order_id::text || ':vendor_warranty:' || p.vendor_warranty_until::text)
          order by p.vendor_warranty_until
          limit 500`,
        [today],
      );
      return rows.map((r) => ({ purchaseId: r.id, orderId: r.order_id, orderNumber: r.order_number, until: r.until }));
    },
  };
}
