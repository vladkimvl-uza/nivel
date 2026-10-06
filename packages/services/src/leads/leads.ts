// leads.create and leads.convert (BUILD_PLAN WP-07): a request from the site or the bot becomes a lead L-<year>-NNNN,
// and the owner turns it into an order NV-<year>-NNNN. Numbers come from ops.next_number inside the transaction of the
// request, so a failed request burns no number (DATA-MAP 6).
import { DbRuleError, type Executor, ops, sales } from "@nivel/db/repos";
import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { type ActorRef, auditActor, requireStaff } from "../orders/actor.ts";
import { NotFoundError, ValidationError, type ValidationIssue } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { assertUuid, isCalendarDate } from "../orders/validate.ts";
import { OUTBOX_TEMPLATE } from "../outbox/contract.ts";

const CHANNELS = ["web", "bot", "tma", "admin", "ai"] as const;
const SCOPES = ["pc", "pc_periph", "setup", "podbor"] as const;
const LEAD_KIND = { pc: "pc", pc_periph: "pc", setup: "setup", podbor: "podbor" } as const;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const MAX_DISTRICT = 80;
const MAX_NAME = 120;
const MAX_USERNAME = 64;
const MAX_UTM_KEYS = 20;
const MAX_UTM_KEY = 40;
const MAX_UTM_VALUE = 200;

export interface NewCustomerInput {
  displayName?: string;
  phoneE164?: string;
  telegramUserId?: number;
  telegramUsername?: string;
  district?: string;
  age18Confirmed?: boolean;
}

export interface CreateLeadInput {
  channel: (typeof CHANNELS)[number];
  scope: (typeof SCOPES)[number];
  lang?: "uz" | "ru";
  district?: string;
  wantedBy?: string;
  budgetSum?: number;
  comment?: string;
  utm?: Record<string, string>;
  configurationId?: string;
  customerId?: string;
  customer?: NewCustomerInput;
}

/** The band of the budget, cut on the bounds of the tiers of the autobuild (parts: 12, 20, 35 million) and the minimum. */
export function budgetBandOf(sum: number | undefined): string | null {
  if (sum === undefined) return null;
  if (sum < 6_700_000) return "lt_6_7m";
  if (sum < 12_000_000) return "6_7m_12m";
  if (sum < 20_000_000) return "12m_20m";
  if (sum < 35_000_000) return "20m_35m";
  return "gte_35m";
}

function validate(input: CreateLeadInput, rt: Runtime): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bad = (path: string, code: string, message: string) => issues.push({ path, code, message });
  if (!CHANNELS.includes(input.channel))
    bad("channel", "channel_unknown", `channel must be one of ${CHANNELS.join(", ")}`);
  if (!SCOPES.includes(input.scope)) bad("scope", "scope_unknown", `scope must be one of ${SCOPES.join(", ")}`);
  if (input.lang !== undefined && input.lang !== "uz" && input.lang !== "ru")
    bad("lang", "lang_unknown", "lang must be uz or ru");
  if (
    input.budgetSum !== undefined &&
    (!Number.isSafeInteger(input.budgetSum) || input.budgetSum < 0 || input.budgetSum > MAX_BUDGET_SUM)
  ) {
    bad("budgetSum", "sum_invalid", `budgetSum must be a whole number of sums from 0 to ${MAX_BUDGET_SUM}`);
  }
  if (input.wantedBy !== undefined && !isCalendarDate(input.wantedBy)) {
    bad("wantedBy", "date_invalid", "wantedBy must be a date like 2026-11-02");
  }
  const short = (path: string, value: unknown, max: number) => {
    if (value !== undefined && (typeof value !== "string" || value.trim() === "" || value.length > max)) {
      bad(path, "text_invalid", `${path} must be a text of 1 to ${max} characters`);
    }
  };
  short("district", input.district, MAX_DISTRICT);
  if (input.utm !== undefined) {
    const entries = input.utm !== null && typeof input.utm === "object" ? Object.entries(input.utm) : null;
    if (
      entries === null ||
      Array.isArray(input.utm) ||
      entries.length > MAX_UTM_KEYS ||
      entries.some(
        ([k, v]) => k.length === 0 || k.length > MAX_UTM_KEY || typeof v !== "string" || v.length > MAX_UTM_VALUE,
      )
    ) {
      bad(
        "utm",
        "utm_invalid",
        `utm must be at most ${MAX_UTM_KEYS} texts with keys up to ${MAX_UTM_KEY} and values up to ${MAX_UTM_VALUE} characters`,
      );
    }
  }
  if (input.comment !== undefined && (typeof input.comment !== "string" || input.comment.length > 2000)) {
    bad("comment", "text_invalid", "comment must be a text of at most 2000 characters");
  }
  if (input.customerId === undefined && input.customer === undefined) {
    bad("customer", "customer_missing", "a lead needs a customer or a customer id");
  }
  const c = input.customer;
  if (c !== undefined && (c === null || typeof c !== "object" || Array.isArray(c))) {
    bad("customer", "customer_invalid", "customer must be an object");
  } else if (c !== undefined) {
    short("customer.displayName", c.displayName, MAX_NAME);
    short("customer.telegramUsername", c.telegramUsername, MAX_USERNAME);
    short("customer.district", c.district, MAX_DISTRICT);
    if (rt.role === "web" && c.telegramUserId !== undefined) {
      // The site cannot tell whose Telegram id this is (only the bot and the verified initData can): taking it would
      // attach the lead to a stranger's record or occupy the id of the real owner.
      bad("customer.telegramUserId", "telegram_id_not_allowed", "the site does not take a Telegram id");
    }
    if (c.phoneE164 !== undefined && (typeof c.phoneE164 !== "string" || !E164.test(c.phoneE164))) {
      bad("customer.phoneE164", "phone_invalid", "phone must be in the international form +998901234567");
    }
    if (c.age18Confirmed !== undefined && typeof c.age18Confirmed !== "boolean") {
      bad("customer.age18Confirmed", "bool_invalid", "age18Confirmed must be true or false");
    }
    if (c.telegramUserId !== undefined && (!Number.isSafeInteger(c.telegramUserId) || c.telegramUserId <= 0)) {
      bad("customer.telegramUserId", "telegram_id_invalid", "telegramUserId must be a positive whole number");
    }
  }
  return issues;
}

/**
 * The customer of the lead, or null when the site could not link one (see below). The site never learns which of the two
 * happened: whether a phone is already a customer is personal data, and the answer is the same either way.
 */
async function resolveCustomer(rt: Runtime, ex: Executor, input: CreateLeadInput): Promise<string | null> {
  if (input.customerId !== undefined) {
    const id = assertUuid(input.customerId, "customerId");
    // Only the columns the site may read: a SELECT of the phone fails for that role.
    const row = await ex.query.customers.findFirst({
      columns: { id: true },
      where: (t, { eq }) => eq(t.id, id),
    });
    if (!row) throw new NotFoundError("customer");
    return row.id;
  }
  const c = input.customer;
  if (c === undefined)
    throw ValidationError.of("customer", "customer_missing", "a lead needs a customer or a customer id");
  // The site has no Telegram id (refused above) and cannot read phones: it has nothing to look for.
  if (rt.role !== "web") {
    const found = await findExisting(ex, c);
    if (found) return found;
  }
  const row = {
    displayName: c.displayName ?? null,
    phoneE164: c.phoneE164 ?? null,
    telegramUserId: c.telegramUserId ?? null,
    telegramUsername: c.telegramUsername ?? null,
    lang: input.lang ?? "uz",
    district: c.district ?? input.district ?? null,
    age18Confirmed: c.age18Confirmed ?? false,
  } as const;
  try {
    // The unique indexes are the judge: two requests of one new person look for him at the same moment, both find
    // nobody, and the second INSERT fails. A failed INSERT aborts a transaction, so it runs in a savepoint.
    return await ex.transaction((sp) => sales.createCustomer(sp, row));
  } catch (e) {
    if (!(e instanceof DbRuleError && e.code === "unique_violation")) throw e;
    // The site cannot read phones and so cannot tell who won: its lead goes on without a customer.
    if (rt.role === "web") return null;
    // The others look again: the winner has committed by now (the loser waited for him on the index).
    const winner = await findExisting(ex, c);
    if (winner) return winner;
    throw ValidationError.of("customer", "customer_exists", "the customer exists but could not be found");
  }
}

/** The customer of the Telegram id, or else of the phone; only for the roles that may read phones. */
async function findExisting(ex: Executor, c: NewCustomerInput): Promise<string | null> {
  if (c.telegramUserId !== undefined) {
    const found = await sales.findCustomerByTelegramId(ex, c.telegramUserId);
    if (found) return found.id;
  }
  if (c.phoneE164 !== undefined) {
    const found = await ex.query.customers.findFirst({
      columns: { id: true },
      where: (t, { eq }) => eq(t.phoneE164, c.phoneE164 as string),
    });
    if (found) return found.id;
  }
  return null;
}

/** The contact of a lead that the site could not link to a customer travels in the comment, for the owner to merge by hand. */
function unlinkedComment(input: CreateLeadInput): string {
  const c = input.customer;
  const who = [c?.displayName, c?.phoneE164, c?.telegramUsername].filter((x) => x !== undefined).join(", ");
  return `[contact, not linked to a customer: ${who}]${
    input.comment
      ? `
${input.comment}`
      : ""
  }`;
}

/**
 * Opens a lead of a person who wrote on the site or in the bot. Returns the number the person is told. The id of the
 * customer is for the bot and the staff only: the site gets none, so that it cannot be used to find out who is a customer.
 */
export async function create(
  input: CreateLeadInput,
  rt?: Runtime,
): Promise<{ leadId: string; number: string; customerId?: string }> {
  const r = runtimeOf(rt);
  const issues = validate(input, r);
  if (issues.length > 0) throw new ValidationError(issues);
  const now = r.now();
  return r.db.transaction(async (tx) => {
    const customerId = await resolveCustomer(r, tx, input);
    let configurationId: string | null = null;
    if (input.configurationId !== undefined) {
      configurationId = assertUuid(input.configurationId, "configurationId");
      const known = await tx.query.configurations.findFirst({
        columns: { id: true },
        where: (t, { eq }) => eq(t.id, configurationId as string),
      });
      if (!known) {
        throw ValidationError.of("configurationId", "configuration_unknown", "the saved configuration does not exist");
      }
    }
    const budgetBand = budgetBandOf(input.budgetSum);
    const lead = await sales.createLead(tx, {
      customerId,
      configurationId,
      channel: input.channel,
      utm: input.utm ?? null,
      lang: input.lang ?? "uz",
      district: input.district ?? null,
      wantedBy: input.wantedBy ?? null,
      scope: input.scope,
      budgetBand,
      comment: customerId === null ? unlinkedComment(input) : (input.comment ?? null),
      now,
    });
    await ops.enqueueOutbox(tx, {
      kind: "telegram_message",
      dedupeKey: `lead:${lead.id}:created`,
      payload: {
        target: "owner_topic",
        templateKey: OUTBOX_TEMPLATE.LEAD_CREATED,
        leadId: lead.id,
        params: {
          number: lead.number,
          scope: input.scope,
          ...(input.district === undefined ? {} : { district: input.district }),
          ...(budgetBand === null ? {} : { budgetBand }),
        },
      },
    });
    return {
      leadId: lead.id,
      number: lead.number,
      ...(customerId === null || r.role === "web" ? {} : { customerId }),
    };
  });
}

/** The owner takes a lead into work: an order NV-<year>-NNNN in the status of a draft. Repeated calls return the same order. */
export async function convert(
  input: { leadId: string },
  actor: ActorRef,
  rt?: Runtime,
): Promise<{ orderId: string; number: string; created: boolean }> {
  const r = runtimeOf(rt);
  requireStaff(actor, "converting a lead");
  requireCapability(r, "orders.create");
  const leadId = assertUuid(input.leadId, "leadId");
  const now = r.now();
  return r.db.transaction(async (tx) => {
    await lockBy(tx, `lead:${leadId}`);
    const lead = await tx.query.leads.findFirst({ where: (t, { eq }) => eq(t.id, leadId) });
    if (!lead) throw new NotFoundError("lead");
    const existing = await tx.query.orders.findFirst({
      columns: { id: true, number: true },
      where: (t, { eq }) => eq(t.leadId, leadId),
    });
    if (existing) return { orderId: existing.id, number: existing.number, created: false };
    if (lead.status !== "new" && lead.status !== "in_review") {
      throw ValidationError.of(
        "leadId",
        "lead_not_open",
        `the lead ${lead.number} is ${lead.status}: it cannot become an order`,
      );
    }
    if (lead.customerId === null) {
      throw ValidationError.of("leadId", "lead_without_customer", `the lead ${lead.number} has no customer`);
    }
    const order = await sales.createOrder(tx, {
      customerId: lead.customerId,
      kind: LEAD_KIND[lead.scope],
      leadId,
      now,
    });
    await sales.setLeadStatus(tx, leadId, "converted");
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "lead.convert",
      entity: "sales.leads",
      entityId: leadId,
      before: { status: lead.status },
      after: { orderId: order.id, number: order.number },
    });
    return { orderId: order.id, number: order.number, created: true };
  });
}
