// Passwords: argon2id (ARCHITECTURE 6.1, 10.1 A04). Node 24 ships argon2 in node:crypto, so the hasher needs no native
// package; the stored form is a PHC string, the same one @node-rs/argon2 writes and reads, so the library can replace
// the adapter later without touching a single stored hash.
import { argon2, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { AUTH_POLICY } from "./policy.ts";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for a stored value that is not an argon2id hash; never throws. */
  verify(stored: string, password: string): Promise<boolean>;
}

export interface Argon2Parameters {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

/** OWASP minimum for argon2id: 19 MiB, 2 passes, 1 lane. */
export const DEFAULT_ARGON2: Argon2Parameters = { memoryKiB: 19_456, passes: 2, parallelism: 1 };

/** A stored string must not make the server allocate what an attacker writes into it. */
const LIMITS = { memoryKiB: 262_144, passes: 10, parallelism: 8 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

export interface PhcParts extends Argon2Parameters {
  salt: Buffer;
  hash: Buffer;
}

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

export function encodePhc(p: PhcParts): string {
  return `$argon2id$v=19$m=${p.memoryKiB},t=${p.passes},p=${p.parallelism}$${b64(p.salt)}$${b64(p.hash)}`;
}

export function decodePhc(phc: string): PhcParts | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return null;
  const [memoryKiB, passes, parallelism] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = Buffer.from(m[4] ?? "", "base64");
  const hash = Buffer.from(m[5] ?? "", "base64");
  if (salt.length < 8 || hash.length < 16) return null;
  return { memoryKiB, passes, parallelism, salt, hash };
}

function derive(password: string, p: Argon2Parameters, salt: Buffer, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(password, "utf8"),
        nonce: salt,
        parallelism: p.parallelism,
        tagLength,
        memory: p.memoryKiB,
        passes: p.passes,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export function createNodeArgon2Hasher(params: Partial<Argon2Parameters> = {}): PasswordHasher {
  const parameters: Argon2Parameters = { ...DEFAULT_ARGON2, ...params };
  return {
    async hash(password) {
      const salt = randomBytes(SALT_BYTES);
      const hash = await derive(password, parameters, salt, TAG_BYTES);
      return encodePhc({ ...parameters, salt, hash });
    },
    async verify(stored, password) {
      const parts = decodePhc(stored);
      if (!parts) return false;
      if (
        parts.memoryKiB < 8 * parts.parallelism ||
        parts.memoryKiB > LIMITS.memoryKiB ||
        parts.passes < 1 ||
        parts.passes > LIMITS.passes ||
        parts.parallelism < 1 ||
        parts.parallelism > LIMITS.parallelism
      ) {
        return false;
      }
      try {
        const actual = await derive(password, parts, parts.salt, parts.hash.length);
        return actual.length === parts.hash.length && timingSafeEqual(actual, parts.hash);
      } catch {
        return false;
      }
    },
  };
}

// ---- policy -----------------------------------------------------------------------------------------------------

/** Problems found in a new password, in Russian, empty when it is acceptable. Length counts characters. */
export function checkPasswordPolicy(password: string, ctx: { email?: string }): string[] {
  const problems: string[] = [];
  const length = [...password].length;
  if (length < AUTH_POLICY.minPasswordLength) problems.push(`Пароль короче ${AUTH_POLICY.minPasswordLength} знаков.`);
  if (length > AUTH_POLICY.maxPasswordLength) problems.push(`Пароль длиннее ${AUTH_POLICY.maxPasswordLength} знаков.`);
  const name = ctx.email?.split("@")[0]?.toLowerCase() ?? "";
  if (name.length >= 4 && password.toLowerCase().includes(name))
    problems.push("Пароль не должен содержать имя из e-mail.");
  if (length >= AUTH_POLICY.minPasswordLength && new Set(password).size === 1) {
    problems.push("Пароль состоит из одного повторяющегося знака.");
  }
  return problems;
}

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // gitleaks:allow the alphabet of generated passwords

/** A generated first password for a new account: 20 characters, about 114 bits; shown once, changed at the first use. */
export function randomPassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}
