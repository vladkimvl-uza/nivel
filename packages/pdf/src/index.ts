// @react-pdf templates: quote, commission report, acts, build passport, warranty card (ARCHITECTURE 6.4). Owner - WP-12.
// The package renders what it is given: the worker (apps/worker/src/jobs/pdf) reads the order through @nivel/services and
// @nivel/db and hands the data over; no money is counted here.

export { ACT_KINDS, renderAct } from "./act.ts";
export { DocumentDataError } from "./guards.ts";
export { renderPassport } from "./passport.ts";
export { renderQuote } from "./quote.ts";
export { PDF_MAX_BYTES, PdfTooLargeError } from "./render.ts";
export { renderCommissionReport } from "./report.ts";
export { CardNumberError } from "./requisites.ts";
// The reader of the PDF the package writes: for the tests of whoever uses the documents (the worker, the bot).
export { flat as flatText, parsePdf } from "./testkit.ts";
export type * from "./types.ts";
export { renderWarrantyCard } from "./warranty.ts";
