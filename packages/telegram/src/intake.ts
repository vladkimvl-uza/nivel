// The job the bot queues when the owner or the assistant puts the photo of a receipt or of a paper act into a topic
// (ARCHITECTURE 7.2 «Фото чеков»). The bot may not write files or purchases (DATA-MAP 2: it reads `ops.files`, `sales.purchases`),
// so it hands over what Telegram gave it: the worker (it holds the token and the directory of the files) downloads the
// photo, registers it in `ops.files` (kind `receipt_photo` or `act_photo`, DATA-MAP 5) and leaves it for the admin panel,
// which records the purchase or the paper signature. Every sum in it is the owner's word under the photo, a hint and not a fact.

/** The name of the job in `ops.outbox` (kind `job`). */
export const BOT_JOB = { FILE_INTAKE: "telegram.file_intake" } as const;

export interface FileIntakePayload {
  job: typeof BOT_JOB.FILE_INTAKE;
  kind: "receipt_photo" | "act_photo";
  orderId: string;
  orderNumber: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  /** Telegram gives photos as JPEG; a document may be PNG, WebP or PDF (an ESF). HEIC is refused before the job. */
  mime: string;
  /** receipt_photo: whole sums from the caption `1250000 Mycom`. */
  amountSum?: number;
  vendorName?: string;
  quoteLineId?: string;
  /** act_photo: the act the photo belongs to. */
  actId?: string;
  byTelegramId: number;
}

export const INTAKE_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

const ORDER_NUMBER = /^NV-\d{4}-\d{4,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** The payload of a job read back by the worker; null for anything the bot would not have written. */
export function parseFileIntake(raw: unknown): FileIntakePayload | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.job !== BOT_JOB.FILE_INTAKE) return null;
  if (p.kind !== "receipt_photo" && p.kind !== "act_photo") return null;
  if (typeof p.orderId !== "string" || !UUID.test(p.orderId)) return null;
  if (typeof p.orderNumber !== "string" || !ORDER_NUMBER.test(p.orderNumber)) return null;
  if (!isText(p.telegramFileId, 200) || !isText(p.telegramFileUniqueId, 100)) return null;
  if (typeof p.mime !== "string" || !(INTAKE_MIMES as readonly string[]).includes(p.mime)) return null;
  if (typeof p.byTelegramId !== "number" || !Number.isSafeInteger(p.byTelegramId) || p.byTelegramId <= 0) return null;
  const out: FileIntakePayload = {
    job: BOT_JOB.FILE_INTAKE,
    kind: p.kind,
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    telegramFileId: p.telegramFileId,
    telegramFileUniqueId: p.telegramFileUniqueId,
    mime: p.mime,
    byTelegramId: p.byTelegramId,
  };
  if (p.kind === "receipt_photo") {
    if (typeof p.amountSum !== "number" || !Number.isSafeInteger(p.amountSum) || p.amountSum < 1) return null;
    if (!isText(p.vendorName, 80)) return null;
    out.amountSum = p.amountSum;
    out.vendorName = p.vendorName;
    if (p.quoteLineId !== undefined) {
      if (typeof p.quoteLineId !== "string" || !UUID.test(p.quoteLineId)) return null;
      out.quoteLineId = p.quoteLineId;
    }
  } else {
    if (typeof p.actId !== "string" || !UUID.test(p.actId)) return null;
    out.actId = p.actId;
  }
  return out;
}
