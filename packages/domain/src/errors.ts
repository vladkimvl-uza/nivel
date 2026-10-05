/** Thrown by contract stubs frozen in WP-00 until the owning work package implements them. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = "NotImplementedError";
  }
}
