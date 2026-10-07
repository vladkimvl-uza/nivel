// Access policy of the admin (ARCHITECTURE 6.1, 10.1 A07): every number here is a decision of the owner or of the
// architecture, kept in one place so that tests and screens read the same value.
export const AUTH_POLICY = {
  /**
   * A wrong password or a wrong code counts; the fifth failure from one source (the address, for one e-mail) closes
   * the sign-in from that source, and the fifth failure of a sensitive change inside a session locks those changes.
   */
  lockAfterFailures: 5,
  lockMinutes: 15,
  /**
   * Over all sources together: the account is locked (its sessions end) after this many failed sign-ins inside one
   * window of `lockMinutes` from the first of them (the count does not carry over from week to week). One source gives
   * at most `lockAfterFailures` of them in a window, and one address (all e-mails together) at most
   * `addressCeilingFailures` checks, so one address cannot reach this number alone: a distributed guess still stops it,
   * and it takes at least four addresses within 15 minutes to end the sessions of the owner.
   */
  accountCeilingFailures: 20,
  /**
   * One address over all e-mails: checks of a password (that were not refused by the limit of the source) that
   * failed, inside one window. A flood of unknown e-mails from one address stops here, before the check of a password
   * and before the journal: a sign-in that goes through gives its attempt back.
   */
  addressCeilingFailures: 20,
  /** A session ends after 8 hours without a request (sliding) ... */
  idleHours: 8,
  /** ... and in any case after 7 days since the sign-in. */
  absoluteDays: 7,
  /** argon2id, from 14 characters (ARCHITECTURE 6.1). */
  minPasswordLength: 14,
  maxPasswordLength: 256,
  recoveryCodeCount: 10,
  totpDigits: 6,
  totpPeriodSeconds: 30,
  /** One period before and after the current one: clocks of a phone and of the server never match exactly. */
  totpWindow: 1,
} as const;

/** `__Host-` pins the cookie to this host, forbids Domain and requires Secure and Path=/ (ARCHITECTURE 6.1). */
export const SESSION_COOKIE = "__Host-nv_admin";

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
