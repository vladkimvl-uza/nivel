// TOTP (RFC 6238, SHA-1, 30 s, 6 digits) on node:crypto. The interface is the one of @oslojs/otp (key bytes, period,
// digits), so the library can replace this file when the integrator wires it (BUILD_PLAN WP-10, request in the branch
// description); codes and secrets are the same, nothing stored changes.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AUTH_POLICY } from "./policy.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Spaces, hyphens, case and `=` padding are ignored: people copy the key from a screen in groups of four. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("not a base32 string");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** 160 random bits: the size of the HMAC-SHA1 block, what authenticator apps expect. */
export function newTotpSecret(): Uint8Array {
  return Uint8Array.from(randomBytes(20));
}

export interface TotpOptions {
  digits?: number;
  period?: number;
}

function counterBytes(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

export function generateTotp(key: Uint8Array, at: Date, options: TotpOptions = {}): string {
  const digits = options.digits ?? AUTH_POLICY.totpDigits;
  const period = options.period ?? AUTH_POLICY.totpPeriodSeconds;
  const counter = Math.floor(at.getTime() / 1000 / period);
  const hmac = createHmac("sha1", key).update(counterBytes(counter)).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Periods accepted before and after the current one. */
  window?: number;
  /** Removes spaces inside the typed code ("123 456"). */
  normalize?: boolean;
}

/**
 * The time step (seconds / period) the code belongs to, or null. Constant-time comparison against every period of the
 * window; only ASCII digits of the right length pass. The caller keeps the last accepted step and refuses a code of
 * the same or an earlier step: a code seen over a shoulder or in a log cannot be used twice.
 */
export function findTotpStep(key: Uint8Array, code: string, now: Date, options: VerifyTotpOptions = {}): number | null {
  const digits = options.digits ?? AUTH_POLICY.totpDigits;
  const period = options.period ?? AUTH_POLICY.totpPeriodSeconds;
  const window = options.window ?? AUTH_POLICY.totpWindow;
  const typed = options.normalize ? code.replace(/\s/g, "") : code;
  if (!new RegExp(`^[0-9]{${digits}}$`).test(typed)) return null;
  const given = Buffer.from(typed);
  const current = Math.floor(now.getTime() / 1000 / period);
  let found: number | null = null;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    const expected = Buffer.from(generateTotp(key, new Date(step * period * 1000), { digits, period }));
    if (timingSafeEqual(given, expected)) found = step;
  }
  return found;
}

export function verifyTotp(key: Uint8Array, code: string, now: Date, options: VerifyTotpOptions = {}): boolean {
  return findTotpStep(key, code, now, options) !== null;
}

export function otpauthUri(o: { secret: Uint8Array; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(o.issuer)}:${encodeURIComponent(o.account)}`;
  const query = [
    `secret=${base32Encode(o.secret)}`,
    `issuer=${encodeURIComponent(o.issuer)}`,
    "algorithm=SHA1",
    `digits=${AUTH_POLICY.totpDigits}`,
    `period=${AUTH_POLICY.totpPeriodSeconds}`,
  ].join("&");
  return `otpauth://totp/${label}?${query}`;
}
