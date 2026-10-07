// The server side of the request form (BUILD_PLAN WP-16, `submitLead`): read the form, drop the bots, limit the rate, hand the
// request to the services through a gateway. The gateway is the only thing that knows `@nivel/services`: it runs
// `leads.create` under the role `web`, in one transaction with the consent and the outbox task `lead.created`, which the bot
// turns into a topic in the group of the owner (WP-13). Here it is a port, so that this part is tested without a database.
import { clientIp, createKeyHasher } from "./client-ip.ts";
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
  recent: Map<string, { number: string; at: number }>;
}

export function createSubmitDeps(o: {
  gateway: LeadGateway;
  limiter?: RateLimiter;
  hash?: (kind: string, value: string) => string;
  now?: () => number;
  log?: SubmitDeps["log"];
}): SubmitDeps {
  const now = o.now ?? Date.now;
  return {
    gateway: o.gateway,
    limiter: o.limiter ?? createRateLimiter({ limit: DAILY_LIMIT, windowMs: DAY_MS, now }),
    hash: o.hash ?? createKeyHasher(),
    now,
    log: o.log ?? ((event, detail) => console.error(event, detail)),
    recent: new Map(),
  };
}

function forgetOld(recent: SubmitDeps["recent"], at: number): void {
  for (const [key, value] of recent) if (at - value.at >= DOUBLE_CLICK_MS) recent.delete(key);
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

  const contactKey = phoneE164
    ? deps.hash("phone", phoneE164)
    : telegramUsername
      ? deps.hash("tg", telegramUsername)
      : "";
  const at = deps.now();
  forgetOld(deps.recent, at);
  const again = contactKey === "" ? undefined : deps.recent.get(contactKey);
  if (again) return { status: "ok", number: again.number };

  const reservation = deps.limiter.reserve([
    phoneE164 ? deps.hash("phone", phoneE164) : "",
    telegramUsername ? deps.hash("tg", telegramUsername) : "",
    ctx.ip ? deps.hash("ip", ctx.ip) : "",
  ]);
  if (!reservation) return { status: "error", code: "rate_limited", fields: {}, values };

  let result: GatewayResult;
  try {
    result = await deps.gateway.submit(command);
  } catch (error) {
    reservation.release();
    deps.log("lead.submit failed", { error: error instanceof Error ? error.name : "unknown" });
    return { status: "error", code: "failed", fields: {}, values };
  }
  if (!result.ok) {
    // Nothing was created: the visitor keeps his place in the limit and his text in the form.
    reservation.release();
    return result.reason === "invalid"
      ? { status: "error", code: "invalid", fields: result.fields, values }
      : { status: "error", code: "unavailable", fields: {}, values };
  }
  if (contactKey !== "") deps.recent.set(contactKey, { number: result.number, at });
  return { status: "ok", number: result.number };
}
