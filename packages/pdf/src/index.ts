// @react-pdf templates: quote, commission report, acts, build passport, warranty card (ARCHITECTURE 6.4). Owner - WP-12.
// The package renders what it is given: the worker (apps/worker/src/jobs/pdf) reads the order through @nivel/services and
// @nivel/db and hands the data over; no money is decided here (every total is printed as given and checked against its rows).

export { ACT_KINDS, renderAct } from "./act.ts";

import { DocumentDataError, DocumentNumberError } from "./guards.ts";
import { PDF_MAX_BYTES, PdfTooLargeError } from "./render.ts";
import { CardNumberError } from "./requisites.ts";

export { renderPassport } from "./passport.ts";
export { renderQuote } from "./quote.ts";
export { renderCommissionReport } from "./report.ts";
// The reader of the PDF the package writes: for the tests of whoever uses the documents (the worker, the bot).
export { flat as flatText, parsePdf } from "./testkit.ts";
export type * from "./types.ts";
export { renderWarrantyCard } from "./warranty.ts";
export { CardNumberError, DocumentDataError, DocumentNumberError, PDF_MAX_BYTES, PdfTooLargeError };

/**
 * The data of a document are at fault, whatever the number of tries: they do not add up, hold a card number, a fraction of a sum or
 * a paper that weighs too much. Any other failure of the renderer (memory, a damaged font) is not the data's and may pass on a
 * second try. Matched by the classes of the package, not by their names.
 */
export function isPermanentPdfError(error: unknown): boolean {
  return (
    error instanceof DocumentDataError ||
    error instanceof DocumentNumberError ||
    error instanceof CardNumberError ||
    error instanceof PdfTooLargeError
  );
}
