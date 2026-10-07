// What a document refuses before it prints a number. The money is whole sums (CLAUDE.md red lines); the services and the database
// fixed the totals, the renderer only checks that what it was given adds up the way the database checks it (sales.quotes
// checks `quotes_fee_split_chk` and `quotes_fee_lines_chk`), so a damaged row never becomes a paper the customer reads.

/** The data of a document do not add up or are not what the document needs; the job that made it must not retry. */
export class DocumentDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentDataError";
  }
}

/** A whole number of sums (or of anything counted): no fraction, no NaN, no unsafe integer. */
export function whole(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a whole number, got ${String(value)}`);
  }
  return value;
}

/** A whole number from 0 up. */
export function wholeNonNegative(label: string, value: unknown): number {
  const n = whole(label, value);
  if (n < 0) throw new RangeError(`${label} must not be negative, got ${n}`);
  return n;
}

export function same(label: string, left: number, right: number): void {
  if (left !== right) throw new DocumentDataError(`${label}: ${left} is not ${right}`);
}
