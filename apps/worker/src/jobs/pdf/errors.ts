// The two kinds of "no" of the job of the documents. Kept apart from build.ts so that the reader of rows can raise them too.

/** The data of the order are damaged or do not fit the document: a second try gives the same answer. */
export class BuildDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildDataError";
  }
}

/** The order has not got the document yet (a report that comes a moment later): the job may try again. */
export class NotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotReadyError";
  }
}
