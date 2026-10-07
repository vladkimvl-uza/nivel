// The photo of a receipt or of a paper act in a topic of the owner's group (ARCHITECTURE 7.2 «Фото чеков»): the caption
// `1250000 Mycom` makes a draft of a purchase, «акт» a draft of a paper signature; the bot proposes the line of the
// quote, the owner confirms with a button, and the photo goes to the worker as a job (the bot may not write files or
// purchases). The customer gets the photo after the purchase is recorded, not before.
import { randomBytes } from "node:crypto";
import { bot as botRepo, sales } from "@nivel/db/repos";
import { orders, outbox } from "@nivel/services";
import {
  BOT_JOB,
  decodeCallback,
  encodeCallback,
  type FileIntakePayload,
  INTAKE_MIMES,
  isActPhotoCaption,
  keyboardMarkup,
  parseReceiptCaption,
  sumText,
} from "@nivel/telegram";
import { Composer } from "grammy";
import type { Message } from "grammy/types";
import type { BotContext } from "../context.ts";
import { orderTopic, topicTarget } from "../store.ts";
import { ack, button, clearButtons, type Rows } from "../ui.ts";

const DRAFT_PREFIX = "draft:";
const DRAFT_TTL_MS = 24 * 3_600_000;
const HEIC = /^image\/hei[cf]$|\.hei[cf]$/i;
/** How many lines of the quote the bot proposes. */
const PROPOSED = 3;

interface Draft {
  kind: "receipt_photo" | "act_photo";
  orderId: string;
  orderNumber: string;
  threadId: number;
  createdAt: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  mime: string;
  byTelegramId: number;
  amountSum?: number;
  vendorName?: string;
  actId?: string;
  /** The lines proposed, in the order of the buttons. */
  lines?: { id: string; title: string }[];
}

type Intake = { fileId: string; uniqueId: string; mime: string } | "heic" | null;

/** The file under the caption: a photo (Telegram gives it as JPEG), or a document of a kind the worker can take. */
function fileOf(m: Message): Intake {
  if (m.photo !== undefined && m.photo.length > 0) {
    const best = m.photo[m.photo.length - 1];
    return best === undefined ? null : { fileId: best.file_id, uniqueId: best.file_unique_id, mime: "image/jpeg" };
  }
  const d = m.document;
  if (d === undefined) return null;
  if (HEIC.test(d.mime_type ?? "") || HEIC.test(d.file_name ?? "")) return "heic";
  if ((INTAKE_MIMES as readonly string[]).includes(d.mime_type ?? "")) {
    return { fileId: d.file_id, uniqueId: d.file_unique_id, mime: d.mime_type as string };
  }
  return null;
}

const draftKey = (id: string) => `${DRAFT_PREFIX}${id}`;
const rep = (ctx: BotContext, text: string, thread: number, rows: Rows = []) => {
  const markup = keyboardMarkup(rows);
  return ctx.reply(text, { message_thread_id: thread, ...(markup === undefined ? {} : { reply_markup: markup }) });
};

async function saveDraft(ctx: BotContext, draft: Draft): Promise<string> {
  const id = randomBytes(4).toString("hex");
  await botRepo.saveSession(ctx.deps.db, draftKey(id), draft as unknown as Record<string, unknown>);
  return id;
}

export const receipts = new Composer<BotContext>();

receipts.on("message", async (ctx, next) => {
  const message = ctx.message;
  const thread = message.message_thread_id;
  const file = thread === undefined ? null : fileOf(message);
  const caption = message.caption;
  const asAct = isActPhotoCaption(caption);
  const receipt = asAct ? null : parseReceiptCaption(caption);
  if (thread === undefined || file === null || (!asAct && receipt === null)) return next();
  if (file === "heic") return rep(ctx, ctx.t("common.send_as_photo"), thread);

  const target = await topicTarget(ctx.deps.db, thread);
  if (target.orderId === null) return rep(ctx, ctx.t("owner.receipt.no_order"), thread);
  const order = await sales.getOrder(ctx.deps.db, target.orderId);
  if (order === null) return rep(ctx, ctx.t("owner.receipt.no_order"), thread);
  const base = {
    orderId: order.id,
    orderNumber: order.number,
    threadId: thread,
    createdAt: ctx.deps.now().toISOString(),
    telegramFileId: file.fileId,
    telegramFileUniqueId: file.uniqueId,
    mime: file.mime,
    byTelegramId: ctx.from.id,
  };

  if (asAct) {
    const act = await ctx.deps.db.query.acts.findFirst({
      columns: { id: true },
      where: (t, { and, eq, isNull }) => and(eq(t.orderId, order.id), isNull(t.signedAt)),
      orderBy: (t, { desc }) => [desc(t.id)],
    });
    if (act === undefined) return rep(ctx, ctx.t("owner.act_photo.no_act", { number: order.number }), thread);
    const id = await saveDraft(ctx, { ...base, kind: "act_photo", actId: act.id });
    return rep(ctx, ctx.t("owner.act_photo.card", { number: order.number }), thread, [
      [
        button(ctx.t("owner.act_photo.confirm"), encodeCallback("r", [id, "ok"])),
        button(ctx.t("owner.receipt.cancel"), encodeCallback("r", [id, "x"])),
      ],
    ]);
  }

  if (receipt === null) return next();
  if (order.status !== "purchasing") {
    return rep(
      ctx,
      ctx.t("owner.receipt.wrong_status", { number: order.number, status: ctx.t(`owner.status.${order.status}`) }),
      thread,
    );
  }
  const view = await orders.getCustomerOrder({ customerId: order.customerId, orderId: order.id }, ctx.deps.rt);
  const bought = await ctx.deps.db.query.purchases.findMany({
    columns: { quoteLineId: true },
    where: (t, { eq }) => eq(t.orderId, order.id),
  });
  const done = new Set(bought.map((p) => p.quoteLineId));
  const open = (view.quote?.lines ?? [])
    .filter((l) => !l.customerOwned && !done.has(l.id))
    .sort(
      (a, b) =>
        Math.abs(a.unitMarketSum * a.qty - receipt.amountSum) - Math.abs(b.unitMarketSum * b.qty - receipt.amountSum),
    )
    .slice(0, PROPOSED);
  const money = await sales.orderMoney(ctx.deps.db, order.id);
  const limit = view.quote?.purchaseLimit ?? 0;
  const lines = [
    ctx.t("owner.receipt.card", {
      sum: sumText(receipt.amountSum, ctx.lang),
      vendor: receipt.vendorName,
      number: order.number,
      limit: sumText(limit, ctx.lang),
      spent: sumText(money.receiptsTotal, ctx.lang),
    }),
  ];
  if (money.receiptsTotal + receipt.amountSum > limit) {
    lines.push(ctx.t("owner.receipt.over_limit", { limit: sumText(limit, ctx.lang) }));
  }
  lines.push(open.length === 0 ? ctx.t("owner.receipt.no_lines") : ctx.t("owner.receipt.pick_line"));
  const id = await saveDraft(ctx, {
    ...base,
    kind: "receipt_photo",
    amountSum: receipt.amountSum,
    vendorName: receipt.vendorName,
    lines: open.map((l) => ({ id: l.id, title: l.title })),
  });
  const rows: Rows = [
    ...open.map((l, i) => [
      button(
        ctx.t("owner.receipt.line", { title: l.title, sum: sumText(l.unitMarketSum * l.qty, ctx.lang) }),
        encodeCallback("r", [id, "l", String(i)]),
      ),
    ]),
    [
      button(ctx.t("owner.receipt.outside"), encodeCallback("r", [id, "o"])),
      button(ctx.t("owner.receipt.cancel"), encodeCallback("r", [id, "x"])),
    ],
  ];
  return rep(ctx, lines.join("\n"), thread, rows);
});

receipts.callbackQuery(/^r:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const [id, action, index] = data?.args ?? [];
  const message = ctx.callbackQuery.message;
  const thread =
    message !== undefined && "message_thread_id" in message
      ? (message.message_thread_id as number | undefined)
      : undefined;
  if (id === undefined || !/^[0-9a-f]{8}$/.test(id) || thread === undefined) return ack(ctx);
  await ack(ctx);
  const raw = await botRepo.getSession(ctx.deps.db, draftKey(id));
  const draft = raw as unknown as Draft | null;
  const fresh = draft !== null && ctx.deps.now().getTime() - Date.parse(draft.createdAt) < DRAFT_TTL_MS;
  if (draft === null || !fresh) return rep(ctx, ctx.t("owner.receipt.expired"), thread);
  // A draft is answered in the topic of its own order only.
  const order = await sales.getOrder(ctx.deps.db, draft.orderId);
  if (order === null || (await orderTopic(ctx.deps.db, order)) !== thread || draft.threadId !== thread) return;

  if (action === "x") {
    await botRepo.deleteSession(ctx.deps.db, draftKey(id));
    await clearButtons(ctx);
    return rep(ctx, ctx.t("common.cancelled"), thread);
  }
  const payload: FileIntakePayload = {
    job: BOT_JOB.FILE_INTAKE,
    kind: draft.kind,
    orderId: draft.orderId,
    orderNumber: draft.orderNumber,
    telegramFileId: draft.telegramFileId,
    telegramFileUniqueId: draft.telegramFileUniqueId,
    mime: draft.mime,
    byTelegramId: draft.byTelegramId,
  };
  if (draft.kind === "receipt_photo") {
    if (action !== "l" && action !== "o") return;
    if (draft.amountSum === undefined || draft.vendorName === undefined) return;
    payload.amountSum = draft.amountSum;
    payload.vendorName = draft.vendorName;
    if (action === "l") {
      const line = draft.lines?.[Number(index)];
      if (line === undefined) return;
      payload.quoteLineId = line.id;
    }
  } else {
    if (action !== "ok" || draft.actId === undefined) return;
    payload.actId = draft.actId;
  }
  // One photo is one job whatever the number of presses (the key is the unique id of the file).
  await outbox.enqueue(
    { kind: "job", payload: { ...payload }, dedupeKey: `intake:${draft.kind}:${draft.telegramFileUniqueId}` },
    {},
    ctx.deps.rt,
  );
  await botRepo.deleteSession(ctx.deps.db, draftKey(id));
  await clearButtons(ctx);
  return rep(
    ctx,
    draft.kind === "receipt_photo"
      ? ctx.t("owner.receipt.saved", { sum: sumText(draft.amountSum ?? 0, ctx.lang), vendor: draft.vendorName ?? "" })
      : ctx.t("owner.act_photo.saved"),
    thread,
  );
});
