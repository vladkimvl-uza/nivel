// Data of the documents. Plain JSON-friendly objects: the worker (apps/worker/src/jobs/pdf) reads the order from the
// database through @nivel/services and @nivel/db and hands them over; the package never computes money again, it writes
// down what the domain and the database fixed (ARCHITECTURE 6.4). Sums are whole sums, rates are basis points.

export type PdfLang = "uz" | "ru";

/** "2026-10-05". */
export type IsoDay = string;
/** A timestamp with an offset or "Z": "2026-10-05T10:02:00.000Z". */
export type IsoStamp = string;

export interface RenderOptions {
  lang: PdfLang;
  /** The offer of the order is a placeholder (not published in both languages): watermark and notice (R-25). */
  stub: boolean;
  /** The document stands on demo data (is_demo): watermark. */
  demo?: boolean;
}

/** The account of the sole proprietor (ops.settings `requisites.ip`). A missing field prints as "after registration". */
export interface IpRequisites {
  holder?: string | null;
  inn?: string | null;
  bank?: string | null;
  account?: string | null;
  mfo?: string | null;
  /** The purpose of the payment as the owner wrote it; `{number}` is replaced by the number of the order. */
  purpose?: string | null;
}
