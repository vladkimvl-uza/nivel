// @react-pdf templates: quote, commission report, acts, build passport, warranty card (ARCHITECTURE 6.4). Owner - WP-12.
// The package renders what it is given: the worker (apps/worker/src/jobs/pdf) reads the order through @nivel/services and
// @nivel/db and hands the data over; no money is counted here.

export { DocumentDataError } from "./guards.ts";
export { renderQuote } from "./quote.ts";
export { PDF_MAX_BYTES, PdfTooLargeError } from "./render.ts";
export { renderCommissionReport } from "./report.ts";
export { CardNumberError } from "./requisites.ts";
export type * from "./types.ts";
