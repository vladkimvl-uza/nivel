// acts.generate and acts.sign (BUILD_PLAN WP-07, ARCHITECTURE 4.9): the act of acceptance of the customer's materials
// (GK art. 661, before the assembly), the act of return of parts of a cancelled order and the act of handover. The act
// is signed by the customer's button (the time, the message and the user are the evidence) or recorded by the owner by
// the photo of the paper act.
import { acts } from "@nivel/db";
import { ops, sales } from "@nivel/db/repos";
import { type ActorRef, auditActor, checkActor, requireStaff } from "../orders/actor.ts";
import { dsl } from "../orders/dsl.ts";
import { ForbiddenError, NotFoundError, ValidationError, type ValidationIssue } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { can, type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { assertUuid } from "../orders/validate.ts";
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
const CUSTOMER_WAYS: readonly SignedVia[] = ["tg_button", "site_button"];
const OWNER_WAYS: readonly SignedVia[] = ["paper_photo"];

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
  if (!(input.kind in ACT_STATUSES))
    throw ValidationError.of("kind", "kind_unknown", `the act kind ${String(input.kind)} does not exist`);
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

/**
 * The customer signs by the button, the owner records the paper act. Only the admin role writes acts: the bot, which reads
 * them, leaves the signature in the outbox for the admin side; the site cannot read acts at all.
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
  if (![...CUSTOMER_WAYS, ...OWNER_WAYS].includes(input.via)) {
    throw ValidationError.of(
      "via",
      "via_unknown",
      `the way of signing must be one of tg_button, paper_photo, site_button`,
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
  const now = r.now();
  return r.db.transaction(async (tx) => {
    const act = await tx.query.acts.findFirst({ where: (t, { eq }) => eq(t.id, actId) });
    if (!act) throw new NotFoundError("act");
    const order = await sales.getOrder(tx, act.orderId);
    if (!order || (actor.kind === "customer" && order.customerId !== actor.id)) throw new NotFoundError("act");
    if (act.signedAt !== null) throw ValidationError.of("actId", "act_already_signed", "the act is already signed");

    if (!can(r, "acts.write")) {
      await ops.enqueueOutbox(tx, {
        kind: "job",
        dedupeKey: `act:${actId}:sign`,
        payload: {
          job: OUTBOX_JOB.ACT_SIGN,
          actId,
          orderId: order.id,
          orderNumber: order.number,
          via: input.via,
          signedAt: now.toISOString(),
          actor: auditActor(actor),
          ...(input.evidence ? { evidence: input.evidence } : {}),
        },
      });
      return { signed: false, queued: true };
    }
    await lockBy(tx, `act:${actId}`);
    const { and, eq, isNull } = dsl(tx);
    // Written once: the condition is in the UPDATE itself, so two presses cannot both win.
    const rows = await tx
      .update(acts)
      .set({ signedAt: now, signedVia: input.via, evidence: input.evidence ?? null })
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
