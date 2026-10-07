// The job pdf.render as the services queue it (OUTBOX_JOB.PDF_RENDER): { job, doc, orderId, orderNumber, actId?, watermarkDraft }.
// Only the document, the order and the act are read: the watermark is decided from the status of the offer of the order
// (services/outbox/contract.ts: "pdf.render derives watermarkDraft from the status of the offer, not from the payload"), and
// every sum, name and number comes from the database, never from the payload.
import { PermanentJobError } from "../../queues/define.ts";

export const PDF_DOCS = [
  "quote",
  "commission_report",
  "act_materials",
  "act_customer_parts",
  "act_handover",
  "passport",
  "warranty",
] as const;
export type PdfDoc = (typeof PDF_DOCS)[number];

export interface PdfRequest {
  doc: PdfDoc;
  orderId: string;
  /** The act to draw; without it the latest act of that kind of the order is taken. */
  actId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePdfRequest(data: unknown): PdfRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PermanentJobError("pdf.render: the payload is not an object");
  }
  const d = data as Record<string, unknown>;
  const doc = d.doc;
  if (typeof doc !== "string" || !(PDF_DOCS as readonly string[]).includes(doc)) {
    throw new PermanentJobError(`pdf.render: unknown document ${JSON.stringify(doc)}`);
  }
  if (typeof d.orderId !== "string" || !UUID.test(d.orderId)) {
    throw new PermanentJobError("pdf.render: orderId is not a uuid");
  }
  let actId: string | null = null;
  if (doc.startsWith("act_") && d.actId !== undefined && d.actId !== null) {
    if (typeof d.actId !== "string" || !UUID.test(d.actId))
      throw new PermanentJobError("pdf.render: actId is not a uuid");
    actId = d.actId;
  }
  return { doc: doc as PdfDoc, orderId: d.orderId, actId };
}
