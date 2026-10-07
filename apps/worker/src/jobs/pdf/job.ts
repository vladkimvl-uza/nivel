// pdf.render: one document of an order in two languages into ops.files (ARCHITECTURE 9). The job reads the order from the database,
// asks @nivel/pdf for the Uzbek and the Russian paper, writes the bytes under FILES_DIR, registers them in ops.files and writes their
// ids into the row of the document. It can run twice or stop half way: a file that is registered under its key is not made again,
// and the links, written once, keep what they have.

import type { ActDoc, CommissionReportDoc, PassportDoc, QuoteDoc, RenderOptions, WarrantyDoc } from "@nivel/pdf";
import {
  CardNumberError,
  DocumentDataError,
  PdfTooLargeError,
  renderAct,
  renderCommissionReport,
  renderPassport,
  renderQuote,
  renderWarrantyCard,
} from "@nivel/pdf";
import type { Logger } from "pino";
import { PermanentJobError } from "../../queues/define.ts";
import { type BuildContext, type Built, build } from "./build.ts";
import { type DocFiles, type LinkResult, sha256Of, storageKeyOf } from "./files.ts";
import { parsePdfRequest } from "./payload.ts";
import type { PdfRows } from "./rows.ts";

export interface PdfJobDeps {
  now(): Date;
  log: Logger;
  rows: PdfRows;
  files: DocFiles;
  ctx: BuildContext;
  /** FILES_DIR is set. */
  filesEnabled: boolean;
}

export interface PdfJobResult {
  doc: string;
  orderNumber: string;
  uz: { id: string; created: boolean };
  ru: { id: string; created: boolean };
  /** `none`: this document has no column for the ids (the warranty card). */
  linked: LinkResult | "none";
}

const LANGS = ["uz", "ru"] as const;

function render(b: Built, options: RenderOptions): Promise<Buffer> {
  switch (b.prepared.doc) {
    case "quote":
      return renderQuote(b.data as QuoteDoc, options);
    case "commission_report":
      return renderCommissionReport(b.data as CommissionReportDoc, options);
    case "act_materials":
    case "act_customer_parts":
    case "act_handover":
      return renderAct(b.actKind as NonNullable<Built["actKind"]>, b.data as ActDoc, options);
    case "passport":
      return renderPassport(b.data as PassportDoc, options);
    case "warranty":
      return renderWarrantyCard(b.data as WarrantyDoc, options);
  }
}

/** What no second try can mend (the data do not add up, a card number, a document too heavy) stops the job for good. */
function permanent(error: unknown): unknown {
  if (
    error instanceof DocumentDataError ||
    error instanceof CardNumberError ||
    error instanceof PdfTooLargeError ||
    error instanceof RangeError
  ) {
    return new PermanentJobError(`${error.name}: ${error.message}`);
  }
  return error;
}

export async function handlePdfRender(deps: PdfJobDeps, data: unknown): Promise<PdfJobResult> {
  const request = parsePdfRequest(data);
  if (!deps.filesEnabled)
    throw new PermanentJobError("pdf.render: FILES_DIR is not set, there is nowhere to put a document");
  let built: Built;
  try {
    built = await build(request, deps.rows, deps.ctx, deps.now());
  } catch (error) {
    throw permanent(error);
  }
  const p = built.prepared;
  const ids: Record<(typeof LANGS)[number], { id: string; created: boolean }> = {
    uz: { id: "", created: false },
    ru: { id: "", created: false },
  };
  for (const lang of LANGS) {
    const key = storageKeyOf(p.orderNumber, p.base, lang);
    const have = await deps.files.find(key);
    if (have !== null) {
      ids[lang] = { id: have, created: false };
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await render(built, { lang, stub: p.stub, demo: p.demo });
    } catch (error) {
      throw permanent(error);
    }
    await deps.files.save(key, bytes);
    const id = await deps.files.register({
      sha256: sha256Of(bytes),
      bytes: bytes.length,
      storageKey: key,
      kind: p.fileKind,
      retentionClass: p.retention,
    });
    ids[lang] = { id, created: true };
  }
  let linked: PdfJobResult["linked"] = "none";
  if (p.link !== null) {
    linked = await deps.files.link(p.link, { uz: ids.uz.id, ru: ids.ru.id });
    if (linked === "no_privilege") {
      deps.log.warn(
        { doc: request.doc, order: p.orderNumber, table: p.link.table },
        "pdf.render: the worker may not write pdf_uz_file_id and pdf_ru_file_id; the documents are kept in ops.files, ask the integrator for GRANT UPDATE (pdf_uz_file_id, pdf_ru_file_id) ON sales.quotes, sales.commission_reports, sales.acts, sales.build_passports TO nivel_worker",
      );
    }
  }
  deps.log.info({ doc: request.doc, order: p.orderNumber, stub: p.stub, demo: p.demo, linked }, "pdf.render done");
  return { doc: request.doc, orderNumber: p.orderNumber, uz: ids.uz, ru: ids.ru, linked };
}
