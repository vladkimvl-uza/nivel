// The messages the relay of the worker sends from ops.outbox (ARCHITECTURE 7.1, 9; contract in
// packages/services/src/outbox/contract.ts). Sending is the worker's (WP-14, throttling per chat); the texts and the
// buttons are here, so that the bot and the worker say the same thing and the buttons are the ones the bot answers.
import { type AppLocale, formatSum } from "@nivel/i18n";
import { actCallback, leadCallback, orderCallback } from "./callback.ts";
import { botTranslator, langOf } from "./messages.ts";

export interface InlineButton {
  text: string;
  callbackData: string;
}

/** A message of the bot: the text (plain, no parse mode), the rows of buttons and the language it is written in. */
export interface RenderedMessage {
  text: string;
  buttons: InlineButton[][];
  lang: AppLocale;
}

/** The payload of a `telegram_message` row of ops.outbox, as the services write it. */
export interface OutboxTelegramPayload {
  target: string;
  templateKey: string;
  params?: Record<string, string | number>;
  orderId?: string;
  orderNumber?: string;
  customerId?: string;
  leadId?: string;
  lang?: string;
  telegramUserId?: number | null;
  topicId?: number;
}

export class UnknownTemplateError extends Error {
  readonly templateKey: string;
  constructor(templateKey: string) {
    super(`no template for the message key ${JSON.stringify(templateKey)}`);
    this.name = "UnknownTemplateError";
    this.templateKey = templateKey;
  }
}

type T = ReturnType<typeof botTranslator>;
interface Ctx {
  p: OutboxTelegramPayload;
  t: T;
  lang: AppLocale;
}
interface Spec {
  /** Who reads it: the customer in his language, the owner's group in Russian. */
  to: "customer" | "owner";
  /** Key of the message in bot.json (the same as the template key, by the rule of the registry of namespaces). */
  message: string;
  values?: (c: Ctx) => Record<string, string | number>;
  buttons?: (c: Ctx) => InlineButton[][];
}

const ORDER_NUMBER = /^NV-\d{4}-\d{4,}$/;
const NUMBER_OF = /^[A-Z]{1,2}-\d{4}-\d{4,}$/;

function numberOf(p: OutboxTelegramPayload): string {
  const n = p.orderNumber ?? (typeof p.params?.number === "string" ? p.params.number : undefined);
  if (n === undefined || !NUMBER_OF.test(n)) {
    throw new Error(
      `the message ${p.templateKey} needs the number of the order or of the lead (orderNumber), got ${String(n)}`,
    );
  }
  return n;
}

function orderNumberOf(p: OutboxTelegramPayload): string {
  const n = numberOf(p);
  if (!ORDER_NUMBER.test(n)) throw new Error(`the message ${p.templateKey} needs the number of an order, got ${n}`);
  return n;
}

const byNumber = (c: Ctx) => ({ number: numberOf(c.p) });
const orderButtons = (action: string, label: string) => (c: Ctx) => [
  [{ text: c.t(label), callbackData: orderCallback(orderNumberOf(c.p), action) }],
];

/** A parameter that is shown as a word when the catalog has one, else as it came (never a raw key of ours). */
function word(t: T, group: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return t("lead.created_empty");
  const v = String(value);
  return /^[A-Za-z0-9_]+$/.test(v) && t.has(`${group}.${v}`) ? t(`${group}.${v}`) : v;
}

/** Free text of a person (a district): shown as written, a dash when empty. */
function free(t: T, value: unknown): string {
  return value === undefined || value === null || String(value).trim() === "" ? t("lead.created_empty") : String(value);
}

const SPECS: Record<string, Spec> = {
  "lead.created": {
    to: "owner",
    message: "lead.created",
    values: ({ p, t }) => ({
      number: numberOf(p),
      scope: word(t, "select.scope", p.params?.scope),
      district: free(t, p.params?.district),
      budget: word(t, "select.band", p.params?.budgetBand),
    }),
    buttons: ({ p, t }) => {
      if (p.leadId === undefined) throw new Error("the message lead.created needs leadId for its buttons");
      return [
        [
          { text: t("owner.lead.work"), callbackData: leadCallback(p.leadId, "wk") },
          { text: t("owner.lead.address"), callbackData: leadCallback(p.leadId, "ad") },
          { text: t("owner.lead.spam"), callbackData: leadCallback(p.leadId, "sp") },
        ],
      ];
    },
  },
  "order.estimate_sent": {
    to: "customer",
    message: "order.estimate_sent",
    values: byNumber,
    buttons: orderButtons("view", "my.open"),
  },
  "order.estimate_expired": {
    to: "customer",
    message: "order.estimate_expired",
    values: byNumber,
    buttons: orderButtons("view", "my.open"),
  },
  "order.accepted": {
    to: "customer",
    message: "order.accepted",
    values: byNumber,
    buttons: orderButtons("view", "my.open"),
  },
  "order.purchase_recorded": {
    to: "customer",
    message: "order.purchase_recorded",
    values: byNumber,
    buttons: orderButtons("view", "my.open"),
  },
  "order.report_sent": {
    to: "customer",
    message: "order.report_sent",
    values: byNumber,
    buttons: (c) => [
      [
        { text: c.t("my.report_ok"), callbackData: orderCallback(orderNumberOf(c.p), "rok") },
        { text: c.t("my.report_question"), callbackData: orderCallback(orderNumberOf(c.p), "obj") },
      ],
    ],
  },
  "order.report_objection": {
    to: "owner",
    message: "order.report_objection",
    values: byNumber,
    buttons: orderButtons("card", "owner.card.refresh"),
  },
  "order.assembly_photos": { to: "customer", message: "order.assembly_photos", values: byNumber },
  "order.ready": { to: "customer", message: "order.ready", values: byNumber, buttons: orderButtons("view", "my.open") },
  "order.delivering": { to: "customer", message: "order.delivering", values: byNumber },
  "order.handed_over": {
    to: "customer",
    message: "order.handed_over",
    values: byNumber,
    buttons: orderButtons("warr", "my.warranty_button"),
  },
  "order.podbor_delivered": { to: "customer", message: "order.podbor_delivered", values: byNumber },
  "order.cancelling": {
    to: "customer",
    message: "order.cancelling",
    values: byNumber,
    buttons: orderButtons("view", "my.open"),
  },
  "order.cancelled": { to: "customer", message: "order.cancelled", values: byNumber },
  "accountant.income_adjustment": { to: "owner", message: "accountant.income_adjustment", values: byNumber },
  "quote.price_uncertain": { to: "customer", message: "quote.price_uncertain" },
  "quote.demo_data": { to: "customer", message: "quote.demo_data" },
  "act.sign_request": {
    to: "customer",
    message: "act.sign_request",
    values: (c) => ({
      number: orderNumberOf(c.p),
      kind: word(c.t, "act.kind", c.p.params?.actKind),
    }),
    buttons: (c) => {
      const actId = c.p.params?.actId;
      if (typeof actId !== "string") throw new Error("the message act.sign_request needs params.actId for its button");
      return [[{ text: c.t("act.sign_button"), callbackData: actCallback(actId) }]];
    },
  },
};

/** The keys the relay can render: the list of the task list of WP-07 and the act with its button. */
export const OUTBOX_TEMPLATE_KEYS: readonly string[] = Object.keys(SPECS);

/** Turns a `telegram_message` of the outbox into the text and the buttons. Throws UnknownTemplateError for a stranger key. */
export function renderOutboxMessage(payload: OutboxTelegramPayload): RenderedMessage {
  const spec = Object.hasOwn(SPECS, payload.templateKey) ? SPECS[payload.templateKey] : undefined;
  if (spec === undefined) throw new UnknownTemplateError(payload.templateKey);
  // The owner's group works in Russian (the admin panel is Russian only); a customer reads his own language.
  const lang: AppLocale = spec.to === "owner" ? "ru" : langOf(payload.lang);
  const ctx: Ctx = { p: payload, t: botTranslator(lang), lang };
  const text = ctx.t(spec.message, spec.values?.(ctx) ?? {});
  return { text, buttons: spec.buttons?.(ctx) ?? [], lang };
}

/** `reply_markup` of the Bot API for rows of buttons; undefined when there are none. */
export function keyboardMarkup(
  buttons: readonly (readonly InlineButton[])[],
): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
  if (buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callbackData }))),
  };
}

/** A sum for a message: whole sums only, with the unit of the language. */
export function sumText(amount: number, lang: AppLocale): string {
  return formatSum(amount, lang);
}
