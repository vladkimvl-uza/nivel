// pdf.render: one document of an order in two languages into ops.files (ARCHITECTURE 9). The job reads the order from the database,
// asks @nivel/pdf for the Uzbek and the Russian paper, writes the bytes under FILES_DIR, registers them in ops.files and writes their
// ids into the row of the document. It can run twice or stop half way: a file that is registered under its key is not made again,
// and the links, written once, keep what they have.
import type { RenderOptions } from "@nivel/pdf";
import type { Logger } from "pino";
import { PermanentJobError } from "../../queues/define.ts";
import { type BuildContext, type Built, build } from "./build.ts";
import { BuildDataError } from "./errors.ts";
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

/**
 * The renderers load on the first document, not at the start of the worker: the package brings the layout engine (wasm) and the
 * fonts, some 50 MB and half a second, which a worker with the flag `feature.pdf` off should not pay.
 */
let loaded: Promise<typeof import("@nivel/pdf")> | undefined;
const pdfPackage = (): Promise<typeof import("@nivel/pdf")> => {
  loaded ??= import("@nivel/pdf");
  return loaded;
};

async function render(b: Built, options: RenderOptions): Promise<Buffer> {
  const pdf = await pdfPackage();
  try {
    switch (b.kind) {
      case "quote":
        return await pdf.renderQuote(b.data, options);
      case "report":
        return await pdf.renderCommissionReport(b.data, options);
      case "act":
        return await pdf.renderAct(b.actKind, b.data, options);
      case "passport":
        return await pdf.renderPassport(b.data, options);
      case "warranty":
        return await pdf.renderWarrantyCard(b.data, options);
    }
  } catch (error) {
    // what the package itself calls data that no second try can mend (a sum that does not add up, a card number, a paper too
    // heavy); any other failure of the renderer (memory, a damaged font) may pass and is tried again
    throw pdf.isPermanentPdfError(error) && error instanceof Error ? permanent(error) : error;
  }
}

/** What no second try can mend stops the job for good; the original error is kept as the cause, with its stack. */
const permanent = (error: Error): PermanentJobError =>
  Object.assign(new PermanentJobError(`${error.name}: ${error.message}`), { cause: error });

export async function handlePdfRender(deps: PdfJobDeps, data: unknown): Promise<PdfJobResult> {
  const request = parsePdfRequest(data);
  if (!deps.filesEnabled)
    throw new PermanentJobError("pdf.render: FILES_DIR is not set, there is nowhere to put a document");
  let built: Built;
  try {
    built = await build(request, deps.rows, deps.ctx, deps.now());
  } catch (error) {
    throw error instanceof BuildDataError ? permanent(error) : error;
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
    const bytes = await render(built, { lang, stub: p.stub, demo: p.demo });
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
