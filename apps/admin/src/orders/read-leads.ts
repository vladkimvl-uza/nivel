// Requests (sales.leads) and the customers an owner may bind them to. Phones are personal data: the search reads them,
// the list shows them only to the roles that may (the owner), the assistant sees names and Telegram names.
import type { Db } from "@nivel/db";

export interface LeadRow {
  id: string;
  number: string;
  status: string;
  scope: string;
  channel: string;
  district: string | null;
  budgetBand: string | null;
  comment: string | null;
  wantedBy: string | null;
  createdAt: Date;
  firstResponseAt: Date | null;
  customerId: string | null;
  customerName: string | null;
  customerUsername: string | null;
  /** The contact the site kept when it could not link a customer (only for the roles that read phones). */
  contactPhone: string | null;
  contactName: string | null;
  contactUsername: string | null;
  orderId: string | null;
  orderNumber: string | null;
}

export interface LeadQuery {
  status?: string;
  limit?: number;
}

const STATUSES = ["new", "in_review", "converted", "rejected", "spam"];

export async function listLeads(db: Db, query: LeadQuery, opts: { seePhone: boolean }): Promise<LeadRow[]> {
  const status = query.status && STATUSES.includes(query.status) ? query.status : null;
  const { rows } = await db.$client.query<{
    id: string;
    number: string;
    status: string;
    scope: string;
    channel: string;
    district: string | null;
    budget_band: string | null;
    comment: string | null;
    wanted_by: string | null;
    created_at: Date;
    first_response_at: Date | null;
    customer_id: string | null;
    display_name: string | null;
    telegram_username: string | null;
    contact_phone: string | null;
    contact_name: string | null;
    contact_username: string | null;
    order_id: string | null;
    order_number: string | null;
  }>(
    `select l.id, l.number, l.status, l.scope, l.channel, l.district, l.budget_band, l.comment, l.wanted_by::text as wanted_by,
            l.created_at, l.first_response_at, l.customer_id, c.display_name, c.telegram_username,
            l.contact_phone, l.contact_name, l.contact_username, o.id as order_id, o.number as order_number
       from sales.leads l
       left join sales.customers c on c.id = l.customer_id
       left join sales.orders o on o.lead_id = l.id
      where ($1::text is null or l.status = $1)
      order by l.created_at desc, l.id desc
      limit $2`,
    [status, query.limit ?? 200],
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    scope: r.scope,
    channel: r.channel,
    district: r.district,
    budgetBand: r.budget_band,
    comment: r.comment,
    wantedBy: r.wanted_by,
    createdAt: r.created_at,
    firstResponseAt: r.first_response_at,
    customerId: r.customer_id,
    customerName: r.display_name,
    customerUsername: r.telegram_username,
    contactPhone: opts.seePhone ? r.contact_phone : null,
    contactName: r.contact_name,
    contactUsername: r.contact_username,
    orderId: r.order_id,
    orderNumber: r.order_number,
  }));
}

export interface CustomerChoice {
  id: string;
  name: string;
  username: string | null;
  phone: string | null;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Customers by a part of the name, the Telegram name or the phone; erased (anonymous) customers are not offered. */
export async function searchCustomers(
  db: Db,
  q: string,
  opts: { seePhone: boolean; limit?: number },
): Promise<CustomerChoice[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const like = `%${escapeLike(text)}%`;
  const { rows } = await db.$client.query<{
    id: string;
    display_name: string | null;
    telegram_username: string | null;
    phone_e164: string | null;
  }>(
    `select id, display_name, telegram_username, phone_e164
       from sales.customers
      where erased_at is null
        and (display_name ilike $1 escape '\\' or telegram_username ilike $1 escape '\\'
             or ($3::boolean and phone_e164 like $1 escape '\\'))
      order by display_name nulls last, id
      limit $2`,
    [like, opts.limit ?? 10, opts.seePhone],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.display_name ?? "Без имени",
    username: r.telegram_username,
    phone: opts.seePhone ? r.phone_e164 : null,
  }));
}
