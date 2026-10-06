// Errors of the services layer. A guard of the order automaton is an answer (`DispatchResult` with `ok: false`), not an
// exception; these classes are for what the caller did wrong (ValidationError, NotFoundError), for what the process
// is not allowed to do (ForbiddenError) and for a broken installation (ConfigError). Apps map them to 4xx, 403 and 5xx.

export interface ValidationIssue {
  /** Where the problem is: `lines.2.qty`, `settlement`. */
  path: string;
  /** Stable machine key: `qty_too_large`, `payments_missing`. */
  code: string;
  /** Plain English text for logs and for the person who has to fix the input. */
  message: string;
}

export class ServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The input is wrong: a 4xx answer with the issues, never a 500. */
export class ValidationError extends ServiceError {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]) {
    super("validation_failed", issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "));
    this.issues = issues;
  }

  static of(path: string, code: string, message: string): ValidationError {
    return new ValidationError([{ path, code, message }]);
  }
}

/** The thing does not exist for this caller. A customer asking for the order of another customer gets this too. */
export class NotFoundError extends ServiceError {
  readonly what: string;
  constructor(what: string) {
    super("not_found", `${what} not found`);
    this.what = what;
  }
}

/** The database role of this process cannot do this, or the actor may not (a site process closing an order). */
export class ForbiddenError extends ServiceError {
  constructor(message: string) {
    super("forbidden", message);
  }
}

/** A setting or the runtime is missing or malformed: the installation is broken, not the request. */
export class ConfigError extends ServiceError {
  constructor(message: string) {
    super("config_invalid", message);
  }
}
