// acts.generate and acts.sign (BUILD_PLAN WP-07, ARCHITECTURE 4.9): the act of acceptance of the customer's materials
// (GK art. 661, before the assembly), the act of return of parts of a cancelled order and the act of handover. The act
// is signed by the customer's button (the time, the message and the user are the evidence) or recorded by the owner by
// the photo of the paper act.
import { acts } from "@nivel/db";
import { DbRuleError, ops, sales } from "@nivel/db/repos";
import { type ActorRef, auditActor, checkActor, requireStaff } from "../orders/actor.ts";
import { dsl } from "../orders/dsl.ts";
import { ForbiddenError, NotFoundError, ValidationError, type ValidationIssue } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { can, type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { assertUuid, isUuid } from "../orders/validate.ts";
import { OUTBOX_JOB } from "../outbox/contract.ts";

export type ActKind = "material_acceptance" | "customer_parts" | "handover";
export type SignedVia = "tg_button" | "paper_photo" | "site_button";

export interface ActLine {
  title: string;
  qty: number;
  serial?: string;
}

/** The status of the order in which each act is drawn. */
const ACT_STATUSES: Readonly<Record<ActKind, readonly string[]>> = {
  material_acceptance: ["settled"],
  customer_parts: ["cancelling"],
  handover: ["ready", "delivering"],
};
const ACT_DOC = {
  material_acceptance: "act_materials",
  customer_parts: "act_customer_parts",
  handover: "act_handover",
} as const;
/**
 * The button of the site is not taken yet: nothing here can tell that the session belongs to the customer of the order
 * (the actor is the word of the caller). It comes back with the checked session of the customer (R2).
 */
const CUSTOMER_WAYS: readonly SignedVia[] = ["tg_button"];
/** The kind in ops.files of the photo of a paper act; a receipt or any other registered file is not one. */
export const ACT_PHOTO_FILE_KIND = "act_photo";
const OWNER_WAYS: readonly SignedVia[] = ["paper_photo"];
const KNOWN_WAYS: readonly SignedVia[] = ["tg_button", "paper_photo", "site_button"];

function checkLines(lines: readonly ActLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  lines.forEach((l, i) => {
    if (
      l === null ||
      typeof l !== "object" ||
      typeof l.title !== "string" ||
      l.title.trim() === "" ||
      l.title.length > 300
    ) {
      issues.push({
        path: `lines.${i}.title`,
        code: "title_invalid",
        message: "A line of the act needs a title of 1 to 300 characters",
      });
    }
    if (l !== null && typeof l === "object" && (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > 99)) {
      issues.push({
        path: `lines.${i}.qty`,
        code: "qty_invalid",
        message: "Quantity must be a whole number from 1 to 99",
      });
    }
  });
  return issues;
}

export async function generate(
  input: { orderId: string; kind: ActKind; lines?: ActLine[] },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<{ actId: string }> {
  const r = runtimeOf(rt);
  const actor = checkActor(actorRef);
  requireStaff(actor, "drawing an act");
  requireCapability(r, "acts.write");
  const orderId = assertUuid(input.orderId, "orderId");
  if (typeof input.kind !== "string" || !Object.hasOwn(ACT_STATUSES, input.kind))
    throw ValidationError.of("kind", "kind_unknown", `the act kind ${String(input.kind)} does not exist`);
  // The shape first: null, a string or a number is "not a list", and only a list can be empty.
  if (input.lines !== undefined && !Array.isArray(input.lines)) {
    throw ValidationError.of("lines", "not_a_list", "the lines of an act must be a list");
  }
  if (input.kind === "material_acceptance" && (input.lines === undefined || input.lines.length === 0)) {
    throw ValidationError.of("lines", "lines_required", "the act of acceptance lists the materials of the customer");
  }
  const lineIssues = checkLines(input.lines ?? []);
  if (lineIssues.length > 0) throw new ValidationError(lineIssues);
  return r.db.transaction(async (tx) => {
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");
    if (!ACT_STATUSES[input.kind].includes(order.status)) {
      throw ValidationError.of(
        "orderId",
        "order_status",
        `the act ${input.kind} is drawn in the status ${ACT_STATUSES[input.kind].join(" or ")}, not ${order.status}`,
      );
    }
    const [row] = await tx
      .insert(acts)
      .values({ orderId, kind: input.kind, lines: input.lines ?? [] })
      .returning({ id: acts.id });
    if (!row) throw new Error("the act was not written");
    await ops.enqueueOutbox(tx, {
      kind: "job",
      dedupeKey: `act:${row.id}:pdf`,
      payload: {
        job: OUTBOX_JOB.PDF_RENDER,
        doc: ACT_DOC[input.kind],
        actId: row.id,
        orderId,
        orderNumber: order.number,
      },
    });
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "act.generate",
      entity: "sales.acts",
      entityId: row.id,
      after: { orderId, kind: input.kind },
    });
    return { actId: row.id };
  });
}

/** What the database function refuses with, as the answers of this scenario (a second press, a press of a stranger). */
function signError(e: unknown): unknown {
  if (!(e instanceof DbRuleError)) return e;
  switch (e.code) {
    case "act_already_signed":
      return ValidationError.of("actId", "act_already_signed", "the act is already signed");
    case "evidence_mismatch":
      return ValidationError.of(
        "evidence.telegramUserId",
        "evidence_mismatch",
        "the Telegram id of the press is not the Telegram id of the customer of the order",
      );
    case "act_not_found":
      return new NotFoundError("act");
    case "invalid_evidence":
      return ValidationError.of(
        "evidence",
        "evidence_required",
        "the press needs the id of the message and the Telegram id",
      );
    default:
      return e;
  }
}

const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * What a signature rests on (ARCHITECTURE 7.2): the file of the paper act, the message of the button with the Telegram id
 * of the person who pressed it, the session of the site. A signature without it proves nothing.
 */
function checkEvidence(via: SignedVia, given: Record<string, unknown> | undefined): Record<string, unknown> {
  const e = given ?? {};
  const need = (path: string, ok: boolean, what: string) => {
    if (!ok) throw ValidationError.of(`evidence.${path}`, "evidence_required", `the signature needs ${what}`);
  };
  if (via === "paper_photo") {
    need("fileId", isUuid(e.fileId), "the id of the registered file of the paper act (evidence.fileId)");
    return { fileId: e.fileId };
  }
  if (via === "tg_button") {
    need("messageId", positiveInt(e.messageId), "the id of the message with the button (evidence.messageId)");
    need("telegramUserId", positiveInt(e.telegramUserId), "the Telegram id of the person (evidence.telegramUserId)");
    return { messageId: e.messageId, telegramUserId: e.telegramUserId };
  }
  // site_button: kept for the day the session of the customer can be checked (see CUSTOMER_WAYS).
  need(
    "sessionId",
    typeof e.sessionId === "string" && e.sessionId.trim() !== "" && e.sessionId.length <= 200,
    "the session of the site (evidence.sessionId)",
  );
  return { sessionId: e.sessionId };
}

/**
 * The customer signs by the button, the owner records the paper act. Only the admin role writes acts: the bot, which reads
 * them, signs the press of the button through sales.sign_act(); the site cannot read acts at all.
 */
export async function sign(
  input: { actId: string; via: SignedVia; evidence?: Record<string, unknown> },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<{ signed: boolean; queued: boolean }> {
  const r = runtimeOf(rt);
  const actor = checkActor(actorRef);
  if (actor.kind !== "customer" && actor.kind !== "owner") {
    throw new ForbiddenError(`an act is signed by the customer or recorded by the owner, not by the ${actor.kind}`);
  }
  if (!can(r, "orders.read")) throw new ForbiddenError("the site role cannot read acts and so cannot sign them");
  const actId = assertUuid(input.actId, "actId");
  if (!KNOWN_WAYS.includes(input.via)) {
    throw ValidationError.of(
      "via",
      "via_unknown",
      "the way of signing must be one of tg_button, paper_photo, site_button",
    );
  }
  if (
    input.evidence !== undefined &&
    (input.evidence === null || typeof input.evidence !== "object" || Array.isArray(input.evidence))
  ) {
    throw ValidationError.of("evidence", "evidence_invalid", "evidence must be an object");
  }
  const allowed = actor.kind === "customer" ? CUSTOMER_WAYS : OWNER_WAYS;
  if (!allowed.includes(input.via)) {
    throw ValidationError.of("via", "via_not_allowed", `the ${actor.kind} cannot sign an act by ${input.via}`);
  }
  if (actor.kind === "owner" && !can(r, "acts.write")) {
    // The bot cannot tell that the person is the owner (it would carry only a name); the admin panel knows the owner.
    throw new ForbiddenError("the owner records a paper act in the admin panel, not through the bot");
  }
  const evidence = checkEvidence(input.via, input.evidence);
  const now = r.now();
  return r.db.transaction(async (tx) => {
    const act = await tx.query.acts.findFirst({ where: (t, { eq }) => eq(t.id, actId) });
    if (!act) throw new NotFoundError("act");
    const order = await sales.getOrder(tx, act.orderId);
    if (!order || (actor.kind === "customer" && order.customerId !== actor.id)) throw new NotFoundError("act");
    if (act.signedAt !== null) throw ValidationError.of("actId", "act_already_signed", "the act is already signed");
    if (input.via === "paper_photo") {
      const file = await ops.getFile(tx, evidence.fileId as string);
      if (!file)
        throw ValidationError.of("evidence.fileId", "file_unknown", "the file of the paper act is not registered");
      if (file.kind !== ACT_PHOTO_FILE_KIND) {
        throw ValidationError.of(
          "evidence.fileId",
          "file_kind_invalid",
          `the file of the paper act must be registered as ${ACT_PHOTO_FILE_KIND}, not ${file.kind}`,
        );
      }
    }
    if (input.via === "tg_button") {
      // The press must be the press of the person the order belongs to: the Telegram id of the evidence is compared
      // with the one the database holds for the customer of the order, here and again by the admin side that writes it.
      const customer = await tx.query.customers.findFirst({
        columns: { telegramUserId: true },
        where: (t, { eq }) => eq(t.id, order.customerId),
      });
      if (customer?.telegramUserId == null || customer.telegramUserId !== evidence.telegramUserId) {
        throw ValidationError.of(
          "evidence.telegramUserId",
          "evidence_mismatch",
          "the Telegram id of the press is not the Telegram id of the customer of the order",
        );
      }
    }

    if (!can(r, "acts.write")) {
      // The bot may not write acts, but the press of the button of the customer reaches the database through a function
      // that signs only for the customer of the order and only once, with the clock of the database. Nobody else may.
      if (!can(r, "acts.sign_button") || input.via !== "tg_button") {
        throw new ForbiddenError(`the ${r.role} role of the database cannot sign an act`);
      }
      try {
        await sales.signActByButton(tx, {
          actId,
          messageId: evidence.messageId as number,
          telegramUserId: evidence.telegramUserId as number,
        });
      } catch (e) {
        throw signError(e);
      }
      return { signed: true, queued: false };
    }
    await lockBy(tx, `act:${actId}`);
    const { and, eq, isNull } = dsl(tx);
    // Written once: the condition is in the UPDATE itself, so two presses cannot both win.
    const rows = await tx
      .update(acts)
      .set({ signedAt: now, signedVia: input.via, evidence })
      .where(and(eq(acts.id, actId), isNull(acts.signedAt)))
      .returning({ id: acts.id });
    if (rows.length === 0) throw ValidationError.of("actId", "act_already_signed", "the act is already signed");
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "act.sign",
      entity: "sales.acts",
      entityId: actId,
      after: { orderId: order.id, via: input.via },
    });
    return { signed: true, queued: false };
  });
}
