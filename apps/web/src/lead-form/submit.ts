// The server side of the request form (BUILD_PLAN WP-16, `submitLead`): read the form, drop the bots, limit the rate, hand the
// request to the services through a gateway. The gateway is the only thing that knows `@nivel/services`: it runs
// `leads.create` under the role `web`, in one transaction with the consent and the outbox task `lead.created`, which the bot
// turns into a topic in the group of the owner (WP-13). Here it is a port, so that this part is tested without a database.
import { clientIp, createKeyHasher, ipKey } from "./client-ip.ts";
import { builtinConsentRef, type ConsentRef } from "./consent-doc.ts";
import { parseLeadForm } from "./form.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import type { FieldErrors, LeadActionState, LeadCommand } from "./types.ts";

export { clientIp };

export type GatewayResult =
  | { ok: true; number: string }
  /** The services refused the request: which fields (codes of `FieldErrorCode`). */
  | { ok: false; reason: "invalid"; fields: FieldErrors }
  /** The services are not connected or the database is down; the visitor is sent to the bot. */
  | { ok: false; reason: "unavailable" };

export interface LeadGateway {
  submit(command: LeadCommand): Promise<GatewayResult>;
}

/** What stands in until the services are wired in (see the integrator request in the report of WP-16). */
export const unavailableGateway: LeadGateway = {
  async submit() {
    return { ok: false, reason: "unavailable" };
  },
};

/** Three requests a day per phone, Telegram nickname and address (ARCHITECTURE 5.3, 10.1). */
export const DAILY_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The same contact within this time is a double click: it gets the answer of the first request again. */
export const DOUBLE_CLICK_MS = 30_000;

export interface SubmitDeps {
  gateway: LeadGateway;
  limiter: RateLimiter;
  hash(kind: string, value: string): string;
  now(): number;
  /** Errors only, never contact data. */
  log(event: string, detail: Record<string, string>): void;
  /** The text of the consent that the page of the consent shows in this language (its document, else the built-in text). */
  consentFor(lang: "uz" | "ru"): Promise<ConsentRef>;
  recent: Map<string, { number: string; at: number }>;
}

export function createSubmitDeps(o: {
  gateway: LeadGateway;
  limiter?: RateLimiter;
  hash?: (kind: string, value: string) => string;
  now?: () => number;
  log?: SubmitDeps["log"];
  consentFor?: SubmitDeps["consentFor"];
}): SubmitDeps {
  const now = o.now ?? Date.now;
  return {
    gateway: o.gateway,
    limiter: o.limiter ?? createRateLimiter({ limit: DAILY_LIMIT, windowMs: DAY_MS, now }),
    hash: o.hash ?? createKeyHasher(),
    now,
    log: o.log ?? ((event, detail) => console.error(event, detail)),
    consentFor: o.consentFor ?? (async (lang) => builtinConsentRef(lang)),
    recent: new Map(),
  };
}

function forgetOld(recent: SubmitDeps["recent"], at: number): void {
  for (const [key, value] of recent) if (at - value.at >= DOUBLE_CLICK_MS) recent.delete(key);
}

/** The text of the consent the visitor was shown; the built-in one when its document cannot be found out. */
async function consentOf(deps: SubmitDeps, lang: "uz" | "ru"): Promise<ConsentRef> {
  try {
    return await deps.consentFor(lang);
  } catch {
    deps.log("lead.consent text fallback", { reason: "the document of the consent could not be read" });
    return builtinConsentRef(lang);
  }
}

/** The whole path of one submission; returns the state the form shows next. */
export async function processLeadForm(
  raw: FormData | Record<string, FormDataEntryValue | null | undefined>,
  ctx: { ip: string | null },
  deps: SubmitDeps,
): Promise<LeadActionState> {
  const parsed = parseLeadForm(raw);
  if (parsed.kind === "honeypot") return { status: "ok", number: null };
  if (parsed.kind === "invalid") {
    return { status: "error", code: "invalid", fields: parsed.fields, values: parsed.values };
  }
  const { command, values } = parsed;
  const { phoneE164, telegramUsername } = command.customer;
  // nicknames of Telegram do not depend on the case of the letters, and neither does the limit
  const nick = telegramUsername?.toLowerCase();

  const contactKey = phoneE164 ? deps.hash("phone", phoneE164) : nick ? deps.hash("tg", nick) : "";
  const at = deps.now();
  forgetOld(deps.recent, at);
  const again = contactKey === "" ? undefined : deps.recent.get(contactKey);
  if (again) return { status: "ok", number: again.number };

  const reservation = deps.limiter.reserve([
    phoneE164 ? deps.hash("phone", phoneE164) : "",
    nick ? deps.hash("tg", nick) : "",
    ctx.ip ? deps.hash("ip", ipKey(ctx.ip)) : "",
  ]);
  if (!reservation) return { status: "error", code: "rate_limited", fields: {}, values };

  let result: GatewayResult;
  try {
    command.consent = { ...command.consent, ...(await consentOf(deps, command.lang)) };
    result = await deps.gateway.submit(command);
  } catch (error) {
    // The place in the limit is not given back: a request that makes the gateway throw is the cheapest one to repeat.
    deps.log("lead.submit failed", { error: error instanceof Error ? error.name : "unknown" });
    return { status: "error", code: "failed", fields: {}, values };
  }
  if (!result.ok) {
    if (result.reason === "invalid") return { status: "error", code: "invalid", fields: result.fields, values };
    // The services are down, not the visitor at fault: he keeps his place in the limit and his text in the form.
    reservation.release();
    return { status: "error", code: "unavailable", fields: {}, values };
  }
  if (contactKey !== "") deps.recent.set(contactKey, { number: result.number, at });
  return { status: "ok", number: result.number };
}
