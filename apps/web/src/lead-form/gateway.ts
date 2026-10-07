// The gateway of the request form to the services (WP-16 integrator request, ARCHITECTURE 5.1, 4.13): `leads.create` under the
// role `web` and the consent to the processing of personal data in ONE transaction, so that a request never exists without the
// evidence of the consent, and a consent never stands for a request that was not made. The outbox task `lead.created` is queued
// by `leads.create` itself (the bot turns it into a topic in the group of the owner, WP-13).
//
// The site names no customer by id and gives no Telegram id (the services and the database refuse both): the contact of the
// visitor goes into the contact fields of the request, the owner links it to a customer by hand (`leads.bindCustomer`).
import { createHmac } from "node:crypto";
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { leads, orders } from "@nivel/services";
import type { GatewayResult, LeadGateway } from "./submit.ts";
import type { FieldErrorCode, FieldErrors, FieldName, LeadCommand } from "./types.ts";

export interface GatewayOptions {
  db: Db;
  /** Key of the hash that names a person who is not a customer yet in the journal of consents (`DATA_ENC_KEY`). */
  subjectKey: string | Buffer;
  /** Errors only, never contact data. */
  log?: (event: string, detail: Record<string, string>) => void;
}

/** Which field of the form a path of the services belongs to. */
const FIELD_OF: readonly (readonly [string, FieldName])[] = [
  ["customer.phoneE164", "phone"],
  ["customer.telegramUsername", "telegram"],
  ["customer.displayName", "name"],
  ["customer.district", "district"],
  ["district", "district"],
  ["budgetSum", "budget"],
  ["comment", "comment"],
  ["scope", "scope"],
];

function codeOf(field: FieldName, issueCode: string): FieldErrorCode {
  if (field === "phone") return "phone_invalid";
  if (field === "telegram") return "telegram_invalid";
  if (field === "budget") return "budget_invalid";
  if (field === "scope") return "scope_invalid";
  return issueCode === "text_invalid" ? "too_long" : "rejected";
}

/** The fields the services refused, by the words of the form; an issue that belongs to no field is `rejected` on the contact. */
export function fieldsOfIssues(issues: readonly { path: string; code: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const hit = FIELD_OF.find(([path]) => issue.path === path);
    const field: FieldName = hit ? hit[1] : "name";
    out[field] ??= codeOf(field, issue.code);
  }
  return out;
}

export function subjectHash(key: string | Buffer, command: LeadCommand): string {
  const who = command.customer.phoneE164 ?? command.customer.telegramUsername ?? "";
  return createHmac("sha256", key).update(`site-consent\0${who}`).digest("hex");
}

export function createServicesGateway(o: GatewayOptions): LeadGateway {
  const log = o.log ?? ((event, detail) => console.error(event, detail));
  return {
    async submit(command): Promise<GatewayResult> {
      try {
        const created = await o.db.transaction(async (tx) => {
          // the transaction is the executor of the services: their own `transaction` calls become savepoints
          const rt = orders.createRuntime({ db: tx as unknown as Db, role: "web" });
          const lead = await leads.create(
            {
              channel: "web",
              scope: command.scope,
              lang: command.lang,
              ...(command.district === undefined ? {} : { district: command.district }),
              ...(command.budgetSum === undefined ? {} : { budgetSum: command.budgetSum }),
              ...(command.comment === undefined ? {} : { comment: command.comment }),
              ...(command.utm === undefined ? {} : { utm: command.utm }),
              customer: command.customer,
            },
            rt,
          );
          await ops.recordConsent(tx, {
            subjectRefHash: subjectHash(o.subjectKey, command),
            kind: command.consent.kind,
            granted: command.consent.granted,
            lang: command.lang,
            channel: "web",
            ...(command.consent.documentId ? { documentId: command.consent.documentId } : {}),
            ...(command.consent.textSha256 ? { textSha256: command.consent.textSha256 } : {}),
            evidence: { textVersion: command.consent.textVersion, lead: lead.number },
          });
          return lead;
        });
        return { ok: true, number: created.number };
      } catch (error) {
        if (error instanceof orders.ValidationError) {
          return { ok: false, reason: "invalid", fields: fieldsOfIssues(error.issues) };
        }
        log("lead.gateway failed", { error: error instanceof Error ? error.name : "unknown" });
        return { ok: false, reason: "unavailable" };
      }
    },
  };
}
