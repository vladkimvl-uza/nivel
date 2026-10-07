// The texts of the documents: the namespace `pdf` of @nivel/i18n (messages/{uz,ru}/pdf.json, Owner - WP-12). The files are
// imported by their path because the namespace is not in the catalog (catalog.ts) until the integrator registers it; after
// that `createNodeTranslator(lang, "pdf")` finds the same texts and this file can go.
import { createNodeTranslator, type NodeTranslator } from "@nivel/i18n";
import ruPdf from "@nivel/i18n/messages/ru/pdf.json" with { type: "json" };
import uzPdf from "@nivel/i18n/messages/uz/pdf.json" with { type: "json" };
import type { PdfLang } from "./types.ts";

export const pdfMessages = { uz: uzPdf, ru: ruPdf } as const;

/** The translator of a document: `t(key, values)`; an unknown key or a missing argument throws: a raw key must never reach a customer. */
export type T = NodeTranslator;

const cache = new Map<PdfLang, T>();

export function pdfText(lang: PdfLang): T {
  let t = cache.get(lang);
  if (t === undefined) {
    t = createNodeTranslator(lang, "pdf", { pdf: pdfMessages[lang] });
    cache.set(lang, t);
  }
  return t;
}
