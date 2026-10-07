// The acceptance of WP-13 in one road, on the fake Bot API and a throwaway database (BUILD_PLAN): language → selection →
// request → topic → estimate → acceptance → receipt → report → act; the answer of the owner is copied to the customer and
// the lines `//` are not; every callback_data is within 64 bytes; no text shows a raw key or a card number.
import { acts, dispatch, leads, payments, quotes, reports } from "@nivel/services";
import { keyboardMarkup, parseFileIntake, renderOutboxMessage } from "@nivel/telegram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inlineButtons } from "./testing/fake-telegram.ts";
import { ownerActor, recordAllPurchases } from "./testing/flow.ts";
import { createHarness, lastButtons, newPerson, OWNER, onboard } from "./testing/harness.ts";
import { type BotWorld, createBotWorld, pcLines } from "./testing/world.ts";

let w: BotWorld;
beforeAll(async () => {
  w = await createBotWorld({ withPolicies: true, withTemplate: true });
});
afterAll(async () => {
  await w.close();
});

/** What the relay of the worker sends with a message: the keyboard, when there is one. */
const markupOf = (buttons: Parameters<typeof keyboardMarkup>[0]) => {
  const markup = keyboardMarkup(buttons);
  return markup === undefined ? {} : { reply_markup: markup };
};
const q = async (sql: string, args: unknown[] = []) => (await w.db.$client.query(sql, args)).rows;

describe("the whole road of a customer through the bot", () => {
  it("language, selection, request, topic, estimate, acceptance, receipt, report, act", async () => {
    w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    const h = createHarness(w);
    const ali = newPerson("Ali", "ali_uz", "uz");
    const press = (data: string, msg = 9000) => h.send(h.tg.press(ali, ali.id, msg, data));
    const inTopic = (fields: Record<string, unknown>, topic: number) =>
      h.send(h.tg.groupMessage(w.groupId, OWNER, fields, topic));
    const pressInGroup = (data: string, topic: number) => h.send(h.tg.press(OWNER, w.groupId, 9100, data, topic));

    // ---- 1. language and consent -----------------------------------------------------------------------------------
    await onboard(h, ali, "uz");
    expect(h.tg.lastSend(ali.id)?.payload.text).toBe("Nima qilamiz?");

    // ---- 2. selection by buttons ------------------------------------------------------------------------------------
    for (const d of ["m:select", "sel:task:gaming", "sel:band:12m_20m", "sel:scope:pc", "sel:done"]) await press(d);
    expect(h.tg.textsTo(ali.id).some((t) => t.includes("Oʻyinlar · 2-daraja"))).toBe(true);
    await press("sel:pick:gaming.T2.A");

    // ---- 3. the request and its topic in the owner's group ----------------------------------------------------------
    await h.send(h.tg.contact(ali, "998901234567"));
    await h.send(h.tg.text(ali, "Chilonzor"));
    await press("ld:term:week");
    const [lead] = await q(
      "select l.id, l.number, l.tg_topic_id, l.customer_id from sales.leads l join sales.customers c on c.id = l.customer_id where c.telegram_user_id = $1",
      [ali.id],
    );
    const topic = Number(lead.tg_topic_id);
    expect(topic).toBeGreaterThan(0);
    const card = h.tg
      .of("sendMessage")
      .find((c) => c.payload.chat_id === w.groupId && c.payload.message_thread_id === topic);
    expect(String(card?.payload.text)).toContain(lead.number);
    expect(inlineButtons(card)).toHaveLength(3);

    // ---- 4. the answer of the owner is copied; the lines `//` stay in the group -------------------------------------
    h.tg.reset();
    await inTopic({ text: "Salom, Ali! Smeta tayyorlanmoqda.\n// mijoz qimmat korpusni soradi" }, topic);
    expect(h.tg.of("copyMessage")).toHaveLength(0);
    expect(h.tg.textsTo(ali.id)).toEqual(["Salom, Ali! Smeta tayyorlanmoqda."]);
    await inTopic({ text: "// ertaga qoʻngʻiroq qilaman" }, topic);
    expect(h.tg.textsTo(ali.id)).toHaveLength(1);
    await h.send(h.tg.text(ali, "Rahmat, kutaman"));
    expect(
      h.tg.of("copyMessage").some((c) => c.payload.chat_id === w.groupId && c.payload.message_thread_id === topic),
    ).toBe(true);

    // ---- 5. the estimate (the admin panel: convert, build, check, send) and the acceptance in the bot ---------------
    const order = await leads.convert({ leadId: lead.id }, ownerActor(w), w.admin);
    const built = await quotes.build(
      { orderId: order.orderId, lines: pcLines(w), tasks: ["gaming"] },
      ownerActor(w),
      w.admin,
    );
    const sent = await quotes.send({ orderId: order.orderId, quoteId: built.quoteId }, ownerActor(w), w.admin);
    expect(sent.ok).toBe(true);
    h.tg.reset();
    await press(`o:${order.number}:view`);
    expect(lastButtons(h, ali.id).map(([, d]) => d)).toEqual([`o:${order.number}:acc`]);
    await press(`o:${order.number}:acc`);
    await press(`o:${order.number}:acc2`);
    expect((await q("select status from sales.orders where id = $1", [order.orderId]))[0].status).toBe("accepted");
    expect(h.tg.textsTo(ali.id).at(-1)).toContain("Xolis QR");

    // ---- 6. the money (the admin panel) and the start of the purchases (the button of the owner in the group) ---------
    const advance = await payments.expect({ orderId: order.orderId, kind: "fee_advance" }, ownerActor(w), w.admin);
    const funds = await payments.expect({ orderId: order.orderId, kind: "purchase_funds" }, ownerActor(w), w.admin);
    await payments.confirm({ paymentId: advance.paymentId, fiscalReceiptNo: "FR-JOURNEY-1" }, ownerActor(w), w.admin);
    await payments.confirm({ paymentId: funds.paymentId, bankDocNo: "PP-JOURNEY-1" }, ownerActor(w), w.admin);
    expect(
      (await dispatch(order.orderId, { type: "FEE_PREPAID", paymentId: advance.paymentId }, ownerActor(w), w.admin)).ok,
    ).toBe(true);
    expect(
      (
        await dispatch(
          order.orderId,
          { type: "FUNDS_RECEIVED", paymentIds: [funds.paymentId], receivedAt: w.clock.now() },
          ownerActor(w),
          w.admin,
        )
      ).ok,
    ).toBe(true);
    w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
    h.tg.reset();
    await h.send(
      h.tg.groupMessage(
        w.groupId,
        OWNER,
        { text: "/card", entities: [{ type: "bot_command", offset: 0, length: 5 }] },
        topic,
      ),
    );
    await pressInGroup(`o:${order.number}:ev:START_PURCHASE`, topic);
    expect((await q("select status from sales.orders where id = $1", [order.orderId]))[0].status).toBe("purchasing");

    // ---- 7. the photo of a receipt in the topic becomes a draft and a job for the worker --------------------------------
    h.tg.reset();
    await inTopic(
      {
        photo: [{ file_id: "AgAC-journey", file_unique_id: "u-journey", width: 800, height: 600 }],
        caption: "1100000 Mycom",
      },
      topic,
    );
    const draft = h.tg.of("sendMessage").find((c) => c.payload.chat_id === w.groupId);
    expect(h.tg.of("copyMessage")).toHaveLength(0);
    await pressInGroup(inlineButtons(draft)[0]?.callback_data as string, topic);
    const job = (
      await q(
        "select payload from ops.outbox where payload ->> 'job' = 'telegram.file_intake' and payload ->> 'orderId' = $1",
        [order.orderId],
      )
    )[0];
    expect(parseFileIntake(job.payload)).toMatchObject({
      kind: "receipt_photo",
      amountSum: 1_100_000,
      vendorName: "Mycom",
    });
    // The admin panel records the purchases (the file of the receipt is registered by the worker in production).
    await recordAllPurchases(w, {
      ...order,
      quoteId: built.quoteId,
      customerId: lead.customer_id,
      leadId: lead.id,
      leadNumber: lead.number,
      topicId: topic,
      person: ali,
    });
    await pressInGroup(`o:${order.number}:ev:PURCHASE_DONE`, topic);
    expect((await q("select status from sales.orders where id = $1", [order.orderId]))[0].status).toBe("report_due");

    // ---- 8. the report and the confirmation of the customer ---------------------------------------------------------
    const report = await reports.generate({ orderId: order.orderId }, ownerActor(w), w.admin);
    expect((await reports.send({ orderId: order.orderId, reportId: report.reportId }, ownerActor(w), w.admin)).ok).toBe(
      true,
    );
    const reportMessage = renderOutboxMessage({
      target: "customer",
      templateKey: "order.report_sent",
      lang: "uz",
      orderNumber: order.number,
    });
    const sentReport = await h.bot.api.sendMessage(ali.id, reportMessage.text, {
      reply_markup: keyboardMarkup(reportMessage.buttons),
    });
    await h.send(h.tg.press(ali, ali.id, sentReport.message_id, `o:${order.number}:rok`));
    expect(h.tg.textsTo(ali.id).at(-1)).toBe("Hisobot tasdiqlandi. Rahmat.");
    const refund = (
      await q("select id from sales.payments where order_id = $1 and kind = 'remainder_refund'", [order.orderId])
    )[0];
    await payments.confirm({ paymentId: refund.id, bankDocNo: "PP-JOURNEY-2" }, ownerActor(w), w.admin);
    expect(
      (await dispatch(order.orderId, { type: "REMAINDER_SETTLED", refundPaymentId: refund.id }, ownerActor(w), w.admin))
        .ok,
    ).toBe(true);

    // ---- 9. the act: the message of the relay with the button, the press of the customer signs --------------------------
    const act = await acts.generate(
      { orderId: order.orderId, kind: "material_acceptance", lines: [{ title: "Case of the customer", qty: 1 }] },
      ownerActor(w),
      w.admin,
    );
    const actMessage = renderOutboxMessage({
      target: "customer",
      templateKey: "act.sign_request",
      lang: "uz",
      orderNumber: order.number,
      params: { actId: act.actId, actKind: "material_acceptance" },
    });
    const sentAct = await h.bot.api.sendMessage(ali.id, actMessage.text, {
      reply_markup: keyboardMarkup(actMessage.buttons),
    });
    await h.send(h.tg.press(ali, ali.id, sentAct.message_id, actMessage.buttons[0]?.[0]?.callbackData as string));
    const signed = (await q("select signed_via, evidence from sales.acts where id = $1", [act.actId]))[0];
    expect(signed).toMatchObject({
      signed_via: "tg_button",
      evidence: { messageId: sentAct.message_id, telegramUserId: ali.id },
    });

    // ---- the rules of the whole road ----------------------------------------------------------------------------
    const everything = h.tg.allCallbackData();
    expect(everything.length).toBeGreaterThan(5);
    for (const data of everything) expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    for (const c of h.tg.calls) {
      const t = String(c.payload.text ?? c.payload.caption ?? "");
      expect(t).not.toMatch(/\{|\}|undefined|NaN/);
      expect(t).not.toMatch(/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/);
    }
  }, 240_000);
});
