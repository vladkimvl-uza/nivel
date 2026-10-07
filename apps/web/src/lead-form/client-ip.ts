// Who is asking, for the limiter only. Caddy puts the address of the connection into X-Forwarded-For (it replaces what the
// visitor sent); the address is never stored or logged, only a keyed hash of it is held in memory.
import { createHmac, randomBytes } from "node:crypto";

const IPV4 = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/;
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;

function plausible(text: string): boolean {
  return IPV4.test(text) || (text.includes(":") && IPV6.test(text));
}

/** The address of the visitor from the headers of the proxy, or null when there is none worth trusting. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && plausible(forwarded)) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  return real && plausible(real) ? real : null;
}

/**
 * Turns a phone, an address or a nickname into a key of the limiter: a keyed hash, so the memory of the process holds no
 * contact data. Without a secret each call of the factory makes its own random one (keys do not survive a restart).
 */
export function createKeyHasher(secret: string | Buffer = randomBytes(32)): (kind: string, value: string) => string {
  return (kind, value) =>
    `${kind}:${createHmac("sha256", secret).update(`${kind}\0${value}`).digest("hex").slice(0, 32)}`;
}
