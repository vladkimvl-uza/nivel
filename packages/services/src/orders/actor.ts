// Who acts (ARCHITECTURE 4.13): an admin user id, the Telegram id of an owner or assistant in the bot, a customer id,
// or "system". For the bot as owner or assistant the database compares the id with ops.admin_users (DATA-MAP 2).
import type { Actor } from "@nivel/domain/order";
import { ForbiddenError } from "./errors.ts";
import { assertText } from "./validate.ts";

export interface ActorRef {
  kind: Actor;
  id: string;
}

const KINDS: readonly string[] = ["system", "customer", "owner", "assistant"];

/** The kind must be one of the four and the id must not be blank: apply_transition refuses an empty actor too. */
export function checkActor(actor: ActorRef): ActorRef {
  if (actor === null || typeof actor !== "object" || !KINDS.includes(actor.kind)) {
    throw new ForbiddenError("the actor must be a system, a customer, an owner or an assistant");
  }
  return { kind: actor.kind, id: assertText(actor.id, "actor.id", 64) };
}

/** The same text apply_transition writes into ops.audit_log: `owner:<id>`. */
export const auditActor = (actor: ActorRef): string => `${actor.kind}:${actor.id}`;

/** The people of the business: the owner and the assistant (not the customer, not the system). */
export function requireStaff(actor: ActorRef, what: string): void {
  if (actor.kind !== "owner" && actor.kind !== "assistant") {
    throw new ForbiddenError(`${what} is for the owner and the assistant, not for ${actor.kind}`);
  }
}
