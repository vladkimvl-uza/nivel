// Secrets at rest (ARCHITECTURE 10.1 A04): the TOTP secret and the hashes of the recovery codes live in one sealed
// value in ops.admin_users.totp_secret_enc, encrypted with AES-256-GCM under DATA_ENC_KEY. The id of the account is
// the authenticated data, so a value copied to another row does not open.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { AUTH_POLICY } from "./policy.ts";

export interface TotpBundle {
  v: 1;
  /** The TOTP secret, base32. */
  secret: string;
  /** SHA-256 (hex) of each recovery code that is not spent yet. */
  recovery: string[];
  /** The newest TOTP time step already accepted: the same code cannot be used twice. */
  lastStep?: number;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** DATA_ENC_KEY: 32 random bytes in base64. */
export function parseDataKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("DATA_ENC_KEY must be 32 bytes in base64");
  return key;
}

const b64u = (b: Buffer) => b.toString("base64url");

export function sealSecret(bundle: TotpBundle, key: Buffer, accountId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(accountId, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  return ["v1", b64u(iv), b64u(cipher.getAuthTag()), b64u(body)].join(".");
}

/** The bundle, or null for anything that does not open: wrong key, another account, damaged or foreign text. */
export function openSecret(sealed: string, key: Buffer, accountId: string): TotpBundle | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1] ?? "", "base64url"));
    decipher.setAAD(Buffer.from(accountId, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[2] ?? "", "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(parts[3] ?? "", "base64url")), decipher.final()]).toString(
      "utf8",
    );
    const value: unknown = JSON.parse(text);
    if (!isBundle(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function isBundle(value: unknown): value is TotpBundle {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.secret === "string" &&
    Array.isArray(v.recovery) &&
    v.recovery.every((x) => typeof x === "string") &&
    (v.lastStep === undefined || typeof v.lastStep === "number")
  );
}

// ---- recovery codes ---------------------------------------------------------------------------------------------
// No 0/o/1/l/i: a code is read from paper.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateRecoveryCodes(count: number = AUTH_POLICY.recoveryCodeCount): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = "";
    for (let i = 0; i < 10; i += 1) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

/** Lower case, no spaces, hyphen after the fifth character: "ABCDE  FGHJK" and "abcdefghjk" are the same code. */
export function normalizeRecoveryCode(text: string): string {
  const raw = text.toLowerCase().replace(/[\s-]/g, "");
  return raw.length === 10 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
}

export const hashRecoveryCode = (text: string): string => sha256Hex(normalizeRecoveryCode(text));

/** The normalized code when the text has the shape of a recovery code, otherwise null (it is then simply a wrong code). */
export function parseRecoveryInput(text: string): string | null {
  const normalized = normalizeRecoveryCode(text);
  return /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/.test(normalized) ? normalized : null;
}
