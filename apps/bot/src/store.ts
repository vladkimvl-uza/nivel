// The queries of the bot that no repository of @nivel/db has. Reads go through the relational API of the schema; the few
// writes the role `nivel_bot` is granted (DATA-MAP 2) are plain statements with parameters, kept here and nowhere else.
import type { Db } from "@nivel/db";
import { DbRuleError, sales } from "@nivel/db/repos";
import type { AppLocale } from "@nivel/i18n";

export type CustomerView = NonNullable<Awaited<ReturnType<typeof sales.findCustomerByTelegramId>>>;

export const findCustomer = (db: Db, telegramUserId: number): Promise<CustomerView | null> =>
  sales.findCustomerByTelegramId(db, telegramUserId);

export interface NewCustomer {
  telegramUserId: number;
  displayName: string | null;
  telegramUsername: string | null;
  lang: AppLocale;
}

/** The customer of the Telegram id, made when he is not there yet. Two first updates at once make one customer. */
export async function ensureCustomer(db: Db, c: NewCustomer): Promise<CustomerView> {
  const found = await findCustomer(db, c.telegramUserId);
  if (found) return found;
  try {
    await sales.createCustomer(db, {
      telegramUserId: c.telegramUserId,
      displayName: c.displayName,
      telegramUsername: c.telegramUsername,
      lang: c.lang,
    });
  } catch (e) {
    // The unique index on the Telegram id is the judge: the other update has won, take his customer.
    if (!(e instanceof DbRuleError && e.code === "unique_violation")) throw e;
  }
  const made = await findCustomer(db, c.telegramUserId);
  if (!made) throw new Error("the customer was not found after it was made");
  return made;
}

export async function setCustomerLang(db: Db, customerId: string, lang: AppLocale): Promise<void> {
  await db.$client.query("update sales.customers set lang = $1 where id = $2", [lang, customerId]);
}

/** Whether the newest consent `pd_processing` of the customer (not tied to an order) is a grant. */
export async function hasProcessingConsent(db: Db, customerId: string): Promise<boolean> {
  const row = await db.query.consents.findFirst({
    columns: { granted: true },
    where: (t, { and, eq, isNull }) =>
      and(eq(t.customerId, customerId), eq(t.kind, "pd_processing"), isNull(t.orderId)),
    orderBy: (t, { desc }) => [desc(t.at), desc(t.id)],
  });
  return row?.granted === true;
}

/** The phone and the district the customer gave. A phone that another customer already has stays with him (the owner merges). */
export async function setCustomerContact(
  db: Db,
  customerId: string,
  c: { phone?: string | undefined; district?: string | undefined },
): Promise<void> {
  if (c.district !== undefined) {
    await db.$client.query("update sales.customers set district = $1 where id = $2 and district is null", [
      c.district,
      customerId,
    ]);
  }
  if (c.phone !== undefined) {
    try {
      await db.$client.query("update sales.customers set phone_e164 = $1 where id = $2 and phone_e164 is null", [
        c.phone,
        customerId,
      ]);
    } catch (e) {
      // The unique index on the phone: it is another customer's. Not an error of this request.
      if ((e as { code?: string }).code !== "23505") throw e;
    }
  }
}

/** Requests of the customer since midnight in Tashkent by the clock of the database (it stamps the day of a request). */
export async function countLeadsToday(db: Db, customerId: string): Promise<number> {
  const { rows } = await db.$client.query<{ n: number }>(
    `select count(*)::int as n from sales.leads
      where customer_id = $1
        and created_at >= (date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent')`,
    [customerId],
  );
  return rows[0]?.n ?? 0;
}

export async function setLeadTopic(db: Db, leadId: string, topicId: number): Promise<boolean> {
  const r = await db.$client.query("update sales.leads set tg_topic_id = $1 where id = $2 and tg_topic_id is null", [
    topicId,
    leadId,
  ]);
  return r.rowCount === 1;
}

/** Open requests of the last three days that have no topic in the owner's group yet. */
export async function leadsWithoutTopic(db: Db, limit = 20): Promise<{ id: string }[]> {
  const { rows } = await db.$client.query<{ id: string }>(
    `select id from sales.leads
      where tg_topic_id is null and status in ('new', 'in_review') and created_at > now() - interval '3 days'
      order by created_at limit $1`,
    [limit],
  );
  return rows;
}

export async function getLead(db: Db, leadId: string) {
  return (await db.query.leads.findFirst({ where: (t, { eq }) => eq(t.id, leadId) })) ?? null;
}

// ---- topics of the owner's group ------------------------------------------------------------------------------
export interface TopicTarget {
  leadId: string | null;
  orderId: string | null;
  customerId: string | null;
}

/** What a topic of the group is about: the request of the topic and the order made from it (or the topic of the order). */
export async function topicTarget(db: Db, threadId: number): Promise<TopicTarget> {
  const lead = await db.query.leads.findFirst({
    columns: { id: true, customerId: true },
    where: (t, { eq }) => eq(t.tgTopicId, threadId),
  });
  const order = await db.query.orders.findFirst({
    columns: { id: true, customerId: true },
    where: (t, { eq, or }) => (lead ? or(eq(t.tgTopicId, threadId), eq(t.leadId, lead.id)) : eq(t.tgTopicId, threadId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return {
    leadId: lead?.id ?? null,
    orderId: order?.id ?? null,
    customerId: order?.customerId ?? lead?.customerId ?? null,
  };
}

/** The topic of an order: its own, else the topic of the request it was made from. */
export async function orderTopic(
  db: Db,
  order: { tgTopicId: number | null; leadId: string | null },
): Promise<number | null> {
  if (order.tgTopicId !== null) return order.tgTopicId;
  if (order.leadId === null) return null;
  return (await getLead(db, order.leadId))?.tgTopicId ?? null;
}

export async function customerTelegram(
  db: Db,
  customerId: string,
): Promise<{ telegramUserId: number | null; lang: AppLocale } | null> {
  const row = await db.query.customers.findFirst({
    columns: { telegramUserId: true, lang: true },
    where: (t, { eq }) => eq(t.id, customerId),
  });
  return row ?? null;
}

/** The topic a message of the customer goes to: his newest open order, else his newest request that has a topic. */
export async function topicForCustomer(db: Db, customerId: string): Promise<number | null> {
  const open = await db.query.orders.findMany({
    columns: { tgTopicId: true, leadId: true },
    where: (t, { and, eq, notInArray }) =>
      and(eq(t.customerId, customerId), notInArray(t.status, ["closed", "cancelled"])),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 5,
  });
  for (const order of open) {
    const topic = await orderTopic(db, order);
    if (topic !== null) return topic;
  }
  const lead = await db.query.leads.findFirst({
    columns: { tgTopicId: true },
    where: (t, { and, eq, isNotNull }) => and(eq(t.customerId, customerId), isNotNull(t.tgTopicId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return lead?.tgTopicId ?? null;
}

/** The first answer of the owner to a request, by the clock of the database; written once. */
export async function markFirstResponse(db: Db, leadId: string): Promise<void> {
  await db.$client.query(
    "update sales.leads set first_response_at = now() where id = $1 and first_response_at is null",
    [leadId],
  );
}
