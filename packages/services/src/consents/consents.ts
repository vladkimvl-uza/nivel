// consents.record and the check of the consents named by ACCEPT (ARCHITECTURE 4.9, 10.2). The automaton of the domain
// counts the ids of the consents; which kinds they must be is verified here. A consent is a row of a journal: a
// withdrawal is a new row, the newest row of a kind decides.
import { CONSENT_KINDS } from "@nivel/db";
import { DbRuleError, type Executor, guarded, ops } from "@nivel/db/repos";
import { ForbiddenError, ValidationError } from "../orders/errors.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { assertText, assertUuid } from "../orders/validate.ts";

export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Consents that name one order (the CHECK `consents_order_scope_chk` of the database). */
const ORDER_SCOPE: readonly ConsentKind[] = [
  "limit_overrun",
  "non_returnable",
  "replacement",
  "no_receipt_purchase",
  "third_party_payer",
];
/** Consents that move money: the site does not record them (the database refuses too). */
const MONEY_KINDS: readonly ConsentKind[] = [
  "limit_overrun",
  "no_receipt_purchase",
  "replacement",
  "third_party_payer",
];

export interface RecordConsentInput {
  kind: ConsentKind;
  customerId: string;
  orderId?: string;
  granted: boolean;
  channel: string;
  /** A document of content.legal_documents: its hash and language are copied from it. */
  documentId?: string;
  lang?: "uz" | "ru";
  evidence?: Record<string, unknown>;
}

/** Kinds the customer must have agreed to at the acceptance: ARCHITECTURE 4.9, ACCEPT. */
export function consentsRequiredForAccept(hasNonReturnable: boolean): ConsentKind[] {
  return hasNonReturnable
    ? ["pd_processing", "supplier_data_transfer", "non_returnable"]
    : ["pd_processing", "supplier_data_transfer"];
}

export async function record(input: RecordConsentInput, rt?: Runtime): Promise<{ id: string }> {
  const r = runtimeOf(rt);
  if (!CONSENT_KINDS.includes(input.kind)) {
    throw ValidationError.of("kind", "kind_unknown", `consent kind must be one of ${CONSENT_KINDS.join(", ")}`);
  }
  if (typeof input.granted !== "boolean")
    throw ValidationError.of("granted", "bool_invalid", "granted must be true or false");
  const customerId = assertUuid(input.customerId, "customerId");
  const channel = assertText(input.channel, "channel", 40);
  const orderId = input.orderId === undefined ? undefined : assertUuid(input.orderId, "orderId");
  if (orderId === undefined && ORDER_SCOPE.includes(input.kind)) {
    throw ValidationError.of("orderId", "order_required", `the consent ${input.kind} names an order`);
  }
  if (
    input.evidence !== undefined &&
    (input.evidence === null || typeof input.evidence !== "object" || Array.isArray(input.evidence))
  ) {
    throw ValidationError.of("evidence", "evidence_invalid", "evidence must be an object");
  }
  if (MONEY_KINDS.includes(input.kind)) requireCapability(r, "consents.money");

  let document: { id: string; textSha256: string; lang: "uz" | "ru" } | undefined;
  if (input.documentId !== undefined) {
    const documentId = assertUuid(input.documentId, "documentId");
    document = await r.db.query.legalDocuments.findFirst({
      columns: { id: true, textSha256: true, lang: true },
      where: (t, { eq }) => eq(t.id, documentId),
    });
    if (!document)
      throw ValidationError.of("documentId", "document_unknown", "the document of the consent does not exist");
  }
  try {
    const id = await guarded(() =>
      ops.recordConsent(r.db, {
        kind: input.kind,
        customerId,
        orderId: orderId ?? null,
        granted: input.granted,
        channel,
        documentId: document?.id ?? null,
        textSha256: document?.textSha256 ?? null,
        lang: document?.lang ?? input.lang ?? null,
        evidence: input.evidence ?? null,
        // The database stamps the time of the public roles itself (ops.stamp_time); the admin names it.
        ...(r.role === "admin" ? { at: r.now() } : {}),
      }),
    );
    return { id };
  } catch (e) {
    if (e instanceof DbRuleError) {
      if (e.code === "consent_mismatch") {
        throw ValidationError.of("customerId", "consent_mismatch", "the consent names another customer than the order");
      }
      if (e.code === "foreign_key_violation") {
        throw ValidationError.of(
          "customerId",
          "reference_unknown",
          "the customer or the order of the consent does not exist",
        );
      }
      if (e.code === "actor_not_allowed" || e.code === "permission_denied") {
        throw new ForbiddenError(`this process may not record the consent ${input.kind}`);
      }
    }
    throw e;
  }
}

export type AcceptConsentsVerdict = { ok: true } | { ok: false; missing: ConsentKind[] };

/**
 * The consents the event ACCEPT names must be, for each required kind, the newest consent of the customer of that kind
 * (for the order, or given before the order exists), granted, and named by the event. Reads only the columns the site
 * may read.
 */
export async function verifyAcceptConsents(
  ex: Executor,
  i: { orderId: string; customerId: string; consentIds: readonly string[]; hasNonReturnable: boolean },
): Promise<AcceptConsentsVerdict> {
  const required = consentsRequiredForAccept(i.hasNonReturnable);
  const rows = await ex.query.consents.findMany({
    columns: { id: true, kind: true, granted: true },
    where: (t, { and, eq, inArray, isNull, or }) =>
      and(eq(t.customerId, i.customerId), inArray(t.kind, required), or(isNull(t.orderId), eq(t.orderId, i.orderId))),
    orderBy: (t, { desc }) => [desc(t.at), desc(t.id)],
  });
  const missing = required.filter((kind) => {
    const newest = rows.find((r) => r.kind === kind);
    return !(newest?.granted === true && i.consentIds.includes(newest.id));
  });
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
