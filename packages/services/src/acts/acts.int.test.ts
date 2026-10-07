import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../orders/dispatch.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { customerActor, ownerActor, purchasingOrder, settledOrder } from "../orders/test-support/flow.ts";
import { createWorld, newFile, type World } from "../orders/test-support/world.ts";
import { generate, sign } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => w.clock.set(new Date("2026-10-13T10:00:00+05:00")));

const owner = () => ownerActor(w);
const actRow = async (id: string) => (await w.db.$client.query("select * from sales.acts where id = $1", [id])).rows[0];
/** What the button of the customer carries when somebody else presses it: the shape is right, the person is not. */
const tg = { messageId: 4711, telegramUserId: 7_100_000_001 };
/** The press of the customer of the order: the Telegram id the database knows for him. */
const tgOf = async (o: { customerId: string }, messageId = 4711) => ({
  messageId,
  telegramUserId: Number(
    (await w.db.$client.query("select telegram_user_id from sales.customers where id = $1", [o.customerId])).rows[0]
      .telegram_user_id,
  ),
});
const materials = [{ title: "Case Fractal North (customer's own)", qty: 1, serial: "FN-001" }];

describe("acts.generate", () => {
  it("draws the act of acceptance of the customer's materials once the money is settled, and asks for its PDF", async () => {
    const o = await settledOrder(w);
    const { actId } = await generate(
      { orderId: o.orderId, kind: "material_acceptance", lines: materials },
      owner(),
      w.admin,
    );
    const row = await actRow(actId);
    expect(row).toMatchObject({ order_id: o.orderId, kind: "material_acceptance", signed_at: null, signed_via: null });
    expect(row.lines).toEqual(materials);
    const jobs = await w.db.$client.query("select payload from ops.outbox where dedupe_key = $1", [`act:${actId}:pdf`]);
    expect(jobs.rows[0].payload).toMatchObject({ job: "pdf.render", doc: "act_materials", actId, orderId: o.orderId });
  });

  it("needs the list of the materials for the acceptance act, and refuses lines that are not whole", async () => {
    const o = await settledOrder(w);
    await expect(generate({ orderId: o.orderId, kind: "material_acceptance" }, owner(), w.admin)).rejects.toMatchObject(
      {
        issues: [{ path: "lines", code: "lines_required" }],
      },
    );
    await expect(
      generate({ orderId: o.orderId, kind: "material_acceptance", lines: [{ title: "", qty: 1 }] }, owner(), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      generate({ orderId: o.orderId, kind: "material_acceptance", lines: [{ title: "x", qty: 0 }] }, owner(), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses lines that are null or not a list for every kind with a validation error, never a TypeError", async () => {
    const o = await settledOrder(w);
    for (const kind of ["material_acceptance", "customer_parts", "handover"] as const) {
      for (const lines of [null, "x", 5, { length: 2 }]) {
        await expect(
          generate({ orderId: o.orderId, kind, lines: lines as never }, owner(), w.admin),
        ).rejects.toMatchObject({
          name: "ValidationError",
          issues: [{ path: "lines", code: "not_a_list" }],
        });
      }
    }
  });

  it("refuses a kind that is a key of every object (constructor, toString) and lines that are not a list", async () => {
    const o = await settledOrder(w);
    for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty", "gift"]) {
      await expect(generate({ orderId: o.orderId, kind: kind as never }, owner(), w.admin)).rejects.toMatchObject({
        name: "ValidationError",
        issues: [{ path: "kind", code: "kind_unknown" }],
      });
    }
    await expect(
      generate({ orderId: o.orderId, kind: "handover", lines: "x" as never }, owner(), w.admin),
    ).rejects.toMatchObject({ name: "ValidationError", issues: [{ path: "lines", code: "not_a_list" }] });
  });

  it("is drawn in the status the act belongs to", async () => {
    const o = await purchasingOrder(w);
    for (const kind of ["material_acceptance", "handover", "customer_parts"] as const) {
      await expect(generate({ orderId: o.orderId, kind, lines: materials }, owner(), w.admin)).rejects.toMatchObject({
        issues: [{ code: "order_status" }],
      });
    }
    const settled = await settledOrder(w);
    await expect(generate({ orderId: settled.orderId, kind: "handover" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "order_status" }],
    });
  });

  it("refuses an unknown kind, an unknown order and the roles that do not write acts", async () => {
    const o = await settledOrder(w);
    await expect(generate({ orderId: o.orderId, kind: "gift" as never }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      generate({ orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", kind: "handover" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      generate({ orderId: o.orderId, kind: "material_acceptance", lines: materials }, owner(), w.bot),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      generate({ orderId: o.orderId, kind: "material_acceptance", lines: materials }, customerActor(o), w.admin),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("acts.sign", () => {
  async function actOf() {
    const o = await settledOrder(w);
    const { actId } = await generate(
      { orderId: o.orderId, kind: "material_acceptance", lines: materials },
      owner(),
      w.admin,
    );
    return { o, actId };
  }

  it("the customer signs by the button: the time, the way and the evidence are written once", async () => {
    const { o, actId } = await actOf();
    const evidence = await tgOf(o);
    const r = await sign({ actId, via: "tg_button", evidence }, customerActor(o), w.admin);
    expect(r).toEqual({ signed: true, queued: false });
    const row = await actRow(actId);
    expect(row.signed_via).toBe("tg_button");
    expect(row.signed_at).toEqual(w.clock.now());
    expect(row.evidence).toEqual(evidence);
    await expect(sign({ actId, via: "tg_button", evidence }, customerActor(o), w.admin)).rejects.toMatchObject({
      issues: [{ code: "act_already_signed" }],
    });
  });

  it("the owner records the paper act by its photo; the ways are not interchangeable", async () => {
    const { o, actId } = await actOf();
    await expect(sign({ actId, via: "tg_button", evidence: tg }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "via_not_allowed" }],
    });
    await expect(
      sign(
        { actId, via: "paper_photo", evidence: { fileId: await newFile(w, { kind: "act_photo" }) } },
        customerActor(o),
        w.admin,
      ),
    ).rejects.toMatchObject({
      issues: [{ code: "via_not_allowed" }],
    });
    const fileId = await newFile(w, { kind: "act_photo" });
    expect(await sign({ actId, via: "paper_photo", evidence: { fileId } }, owner(), w.admin)).toEqual({
      signed: true,
      queued: false,
    });
  });

  it("another customer cannot sign it: not found", async () => {
    const { actId } = await actOf();
    const stranger = await settledOrder(w);
    await expect(
      sign({ actId, via: "tg_button", evidence: tg }, customerActor(stranger), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      sign(
        { actId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", via: "tg_button", evidence: tg },
        customerActor(stranger),
        w.admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the bot cannot write acts, but signs the press of the button through the function of the database, with its clock", async () => {
    const { o, actId } = await actOf();
    const evidence = await tgOf(o);
    const before = Date.now();
    const r = await sign({ actId, via: "tg_button", evidence }, customerActor(o), w.bot);
    expect(r).toEqual({ signed: true, queued: false });
    const row = await actRow(actId);
    expect(row.signed_via).toBe("tg_button");
    expect(row.evidence).toEqual(evidence);
    // The time is the one of the database (the fake clock of the tests is days ahead of it).
    expect(Math.abs((row.signed_at as Date).getTime() - before)).toBeLessThan(60_000);
    // Nothing waits in the outbox for the admin side any more.
    const queued = await w.db.$client.query("select 1 from ops.outbox where dedupe_key = $1", [`act:${actId}:sign`]);
    expect(queued.rowCount).toBe(0);
    // The press of the same person again: the act is signed once.
    await expect(sign({ actId, via: "tg_button", evidence }, customerActor(o), w.bot)).rejects.toMatchObject({
      issues: [{ code: "act_already_signed" }],
    });
    // The signature has an audit row of the database function, with the role that signed.
    const audit = await w.db.$client.query(
      "select actor, after from ops.audit_log where entity_id = $1 and action = 'act.sign'",
      [actId],
    );
    expect(audit.rows).toEqual([
      {
        actor: `customer:${o.customerId}`,
        after: { orderId: o.orderId, via: "tg_button", db_role: "nivel_bot" },
      },
    ]);
  });

  it("two presses at the same moment sign once, through the bot or the admin panel", async () => {
    const { o, actId } = await actOf();
    const evidence = await tgOf(o);
    const results = await Promise.allSettled([
      sign({ actId, via: "tg_button", evidence }, customerActor(o), w.bot),
      sign({ actId, via: "tg_button", evidence }, customerActor(o), w.bot),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ issues: [{ code: "act_already_signed" }] });
  });

  it("takes a signature only with its evidence: the file of the paper act, the message of the button, the session of the site", async () => {
    const { o, actId } = await actOf();
    const evidenceError = (path: string) => ({
      name: "ValidationError",
      issues: [{ path, code: "evidence_required" }],
    });
    await expect(sign({ actId, via: "paper_photo" }, owner(), w.admin)).rejects.toMatchObject(
      evidenceError("evidence.fileId"),
    );
    await expect(
      sign({ actId, via: "paper_photo", evidence: { fileId: "f1" } }, owner(), w.admin),
    ).rejects.toMatchObject(evidenceError("evidence.fileId"));
    // A well-formed id of a file that is not registered.
    await expect(
      sign(
        { actId, via: "paper_photo", evidence: { fileId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" } },
        owner(),
        w.admin,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "evidence.fileId", code: "file_unknown" }] });
    await expect(sign({ actId, via: "tg_button" }, customerActor(o), w.admin)).rejects.toMatchObject(
      evidenceError("evidence.messageId"),
    );
    await expect(
      sign({ actId, via: "tg_button", evidence: { messageId: 1 } }, customerActor(o), w.admin),
    ).rejects.toMatchObject(evidenceError("evidence.telegramUserId"));
    await expect(
      sign({ actId, via: "tg_button", evidence: { messageId: 0, telegramUserId: 5 } }, customerActor(o), w.admin),
    ).rejects.toMatchObject(evidenceError("evidence.messageId"));
    expect((await actRow(actId)).signed_at).toBeNull();
  });

  it("takes the press only from the person the order belongs to: the Telegram id of the evidence must be the customer's", async () => {
    const { o, actId } = await actOf();
    const stranger = await settledOrder(w);
    const mismatch = {
      name: "ValidationError",
      issues: [{ path: "evidence.telegramUserId", code: "evidence_mismatch" }],
    };
    for (const rt of [w.admin, w.bot]) {
      await expect(
        sign({ actId, via: "tg_button", evidence: await tgOf(stranger) }, customerActor(o), rt),
      ).rejects.toMatchObject(mismatch);
      await expect(
        sign({ actId, via: "tg_button", evidence: { messageId: 1, telegramUserId: 1 } }, customerActor(o), rt),
      ).rejects.toMatchObject(mismatch);
    }
    // Nothing was signed and nothing was queued.
    expect((await actRow(actId)).signed_at).toBeNull();
    const queued = await w.db.$client.query("select 1 from ops.outbox where dedupe_key = $1", [`act:${actId}:sign`]);
    expect(queued.rowCount).toBe(0);
    // A customer without a Telegram id cannot be matched by a press of a button at all.
    await w.db.$client.query("update sales.customers set telegram_user_id = null where id = $1", [o.customerId]);
    await expect(sign({ actId, via: "tg_button", evidence: tg }, customerActor(o), w.admin)).rejects.toMatchObject(
      mismatch,
    );
  });

  it("does not take the button of the site until the session of the customer can be checked, and a photo that is not of an act", async () => {
    const { o, actId } = await actOf();
    await expect(
      sign({ actId, via: "site_button", evidence: { sessionId: "sess-1" } }, customerActor(o), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "via", code: "via_not_allowed" }] });
    const receipt = await newFile(w); // a receipt_photo: registered, but not the paper act
    await expect(
      sign({ actId, via: "paper_photo", evidence: { fileId: receipt } }, owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "evidence.fileId", code: "file_kind_invalid" }] });
    expect((await actRow(actId)).signed_at).toBeNull();
  });

  it("the bot does not carry the word of the owner: the paper act is recorded in the admin panel, where the owner is known", async () => {
    const { actId } = await actOf();
    const fileId = await newFile(w, { kind: "act_photo" });
    await expect(sign({ actId, via: "paper_photo", evidence: { fileId } }, owner(), w.bot)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const queued = await w.db.$client.query("select 1 from ops.outbox where dedupe_key = $1", [`act:${actId}:sign`]);
    expect(queued.rowCount).toBe(0);
  });

  it("the site cannot read acts and so cannot sign them", async () => {
    const { o, actId } = await actOf();
    await expect(
      sign({ actId, via: "tg_button", evidence: await tgOf(o) }, customerActor(o), w.web),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an unknown way and evidence that is not an object", async () => {
    const { o, actId } = await actOf();
    await expect(sign({ actId, via: "carrier_pigeon" as never }, customerActor(o), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      sign({ actId, via: "tg_button", evidence: [1] as never }, customerActor(o), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("MATERIALS_ACCEPTED needs the signed act of the order", () => {
  it("refuses an act that is not signed, of another kind or of another order, and takes the signed one", async () => {
    const o = await settledOrder(w);
    const other = await settledOrder(w);
    w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
    const { actId } = await generate(
      { orderId: o.orderId, kind: "material_acceptance", lines: materials },
      owner(),
      w.admin,
    );
    const foreign = await generate(
      { orderId: other.orderId, kind: "material_acceptance", lines: materials },
      owner(),
      w.admin,
    );
    await sign({ actId: foreign.actId, via: "tg_button", evidence: await tgOf(other) }, customerActor(other), w.admin);
    const run = (id: string) => dispatch(o.orderId, { type: "MATERIALS_ACCEPTED", actId: id }, owner(), w.admin);
    expect(await run(actId)).toEqual({ ok: false, error: "act_missing" }); // not signed
    expect(await run(foreign.actId)).toEqual({ ok: false, error: "act_missing" }); // another order
    expect(await run("not-a-uuid")).toEqual({ ok: false, error: "act_missing" });
    await sign({ actId, via: "tg_button", evidence: await tgOf(o) }, customerActor(o), w.admin);
    expect(await run(actId)).toEqual({ ok: true, status: "assembling" });
  });
});
