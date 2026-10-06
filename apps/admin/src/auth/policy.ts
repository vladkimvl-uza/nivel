// Access policy of the admin (ARCHITECTURE 6.1, 10.1 A07): every number here is a decision of the owner or of the
// architecture, kept in one place so that tests and screens read the same value.
export const AUTH_POLICY = {
  /** A wrong password or a wrong code counts; the fifth failure locks the account. */
  lockAfterFailures: 5,
  lockMinutes: 15,
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
