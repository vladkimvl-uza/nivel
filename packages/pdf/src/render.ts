import type { DocumentProps } from "@react-pdf/renderer";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { refreshFonts, registerFonts } from "./fonts.ts";

/** The most a document may weigh (BUILD_PLAN WP-12): the subsets of the fonts keep a real one near 30-60 KB. */
export const PDF_MAX_BYTES = 300 * 1024;

export class PdfTooLargeError extends Error {
  readonly bytes: number;
  readonly limit: number;
  constructor(bytes: number, limit: number) {
    super(`the PDF weighs ${bytes} bytes, the limit is ${limit}`);
    this.name = "PdfTooLargeError";
    this.bytes = bytes;
    this.limit = limit;
  }
}

/** The renderer shares its fonts between documents, so two renders must not overlap (see refreshFonts). */
let turn: Promise<unknown> = Promise.resolve();

/** Renders a document to bytes, one at a time; refuses one over the limit. */
export function toPdfBuffer(document: ReactElement<DocumentProps>, limit: number = PDF_MAX_BYTES): Promise<Buffer> {
  const run = turn.then(async () => {
    registerFonts();
    refreshFonts();
    const bytes = await renderToBuffer(document);
    if (bytes.length > limit) throw new PdfTooLargeError(bytes.length, limit);
    return bytes;
  });
  turn = run.catch(() => undefined);
  return run;
}
