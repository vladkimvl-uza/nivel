// Reading and checking the request form on the server. The browser checks nothing that matters: whatever comes here is
// read again, as text, with the same limits the services and the database apply (ARCHITECTURE 5.1, 10.1 A05).
import { parseBudgetMillions } from "./budget.ts";
import { normalizePhone } from "./phone.ts";
import { type FieldErrors, FORM_SCOPES, type FormScope, type LeadCommand, type LeadFormValues } from "./types.ts";

/**
 * Version of the consent text built into the site (`site.legal.consentPd`). It is written into the consent evidence until a
 * published document of `content.legal_documents` takes its place; change it together with that text.
 */
export const BUILTIN_PD_CONSENT_VERSION = "builtin-2026-10-07";

const MAX_NAME = 120;
const MAX_DISTRICT = 80;
const MAX_COMMENT = 2000;
const MAX_UTM_VALUE = 200;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const TELEGRAM = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const TELEGRAM_PREFIX = /^(?:https?:\/\/)?(?:t|telegram)\.me\//i;
const CONSENT_ON = new Set(["on", "true", "1"]);

type RawForm = FormData | Record<string, FormDataEntryValue | null | undefined>;

export type ParsedLead =
  /** A bot filled the hidden field: the request is dropped without a word. */
  | { kind: "honeypot" }
  | { kind: "invalid"; fields: FieldErrors; values: Partial<LeadFormValues> }
  | { kind: "ok"; command: LeadCommand; values: LeadFormValues };

function read(raw: RawForm, key: string): string {
  const value = raw instanceof FormData ? raw.get(key) : raw[key];
  return typeof value === "string" ? value : "";
}

/** A control character other than the line break and the tab: Postgres refuses NUL in text, and no name or nickname has one. */
function hasControl(text: string, allowLines: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x7f) return true;
    if (c < 0x20 && !(allowLines && (c === 0x09 || c === 0x0a || c === 0x0d))) return true;
  }
  return false;
}

/** `@nick`, `nick` and `https://t.me/nick` all give `nick`; anything else that is not a nickname gives null. */
function normalizeTelegram(raw: string): string | null {
  const text = raw.trim().replace(TELEGRAM_PREFIX, "").replace(/^@/, "");
  return TELEGRAM.test(text) ? text : null;
}

export function parseLeadForm(raw: RawForm): ParsedLead {
  if (read(raw, "website").trim() !== "") return { kind: "honeypot" };

  const values: LeadFormValues = {
    name: read(raw, "name").trim(),
    phone: read(raw, "phone").trim(),
    telegram: read(raw, "telegram").trim(),
    scope: read(raw, "scope").trim(),
    district: read(raw, "district").trim(),
    budget: read(raw, "budget").trim(),
    comment: read(raw, "comment").trim(),
  };
  const fields: FieldErrors = {};

  const phone = values.phone === "" ? undefined : normalizePhone(values.phone);
  if (values.phone !== "" && phone === null) fields.phone = "phone_invalid";
  const telegram = values.telegram === "" ? undefined : normalizeTelegram(values.telegram);
  if (values.telegram !== "" && telegram === null) fields.telegram = "telegram_invalid";
  if (values.phone === "" && values.telegram === "") fields.phone = "contact_required";

  const scope = (FORM_SCOPES as readonly string[]).includes(values.scope) ? (values.scope as FormScope) : null;
  if (scope === null) fields.scope = "scope_invalid";

  const budget = parseBudgetMillions(values.budget);
  if (!budget.ok) fields.budget = "budget_invalid";

  if (values.name.length > MAX_NAME) fields.name = "too_long";
  if (values.district.length > MAX_DISTRICT) fields.district = "too_long";
  if (values.comment.length > MAX_COMMENT) fields.comment = "too_long";
  if (hasControl(values.name, false)) fields.name = "rejected";
  if (hasControl(values.district, false)) fields.district = "rejected";
  if (hasControl(values.comment, true)) fields.comment = "rejected";
  if (hasControl(values.telegram, false)) fields.telegram = "rejected";
  if (CONSENT_ON.has(read(raw, "consent").trim().toLowerCase())) values.consent = "on";
  else fields.consent = "consent_required";

  if (Object.keys(fields).length > 0 || scope === null || !budget.ok) return { kind: "invalid", fields, values };

  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = read(raw, key).trim();
    if (value !== "" && value.length <= MAX_UTM_VALUE && !hasControl(value, false)) utm[key] = value;
  }

  const customer: LeadCommand["customer"] = {};
  if (values.name !== "") customer.displayName = values.name;
  if (phone) customer.phoneE164 = phone;
  if (telegram) customer.telegramUsername = telegram;

  const command: LeadCommand = {
    channel: "web",
    scope,
    lang: read(raw, "locale") === "ru" ? "ru" : "uz",
    customer,
    consent: { kind: "pd_processing", granted: true, textVersion: BUILTIN_PD_CONSENT_VERSION },
  };
  if (values.district !== "") command.district = values.district;
  if (budget.sum !== undefined) command.budgetSum = budget.sum;
  if (values.comment !== "") command.comment = values.comment;
  if (Object.keys(utm).length > 0) command.utm = utm;
  return { kind: "ok", command, values };
}
