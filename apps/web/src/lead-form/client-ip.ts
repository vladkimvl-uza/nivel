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

const HEXTET = /^[0-9a-fA-F]{1,4}$/;

/** The eight groups of an IPv6 address, or null when the text is not one (an IPv4 tail counts as two groups). */
function ipv6Groups(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const pieces = part.split(":");
    for (const [i, piece] of pieces.entries()) {
      if (i === pieces.length - 1 && IPV4.test(piece)) {
        const octets = piece.split(".").map(Number);
        if (octets.some((o) => o > 255)) return null;
        groups.push(
          ((octets[0] as number) << 8) | (octets[1] as number),
          ((octets[2] as number) << 8) | (octets[3] as number),
        );
      } else if (HEXTET.test(piece)) groups.push(Number.parseInt(piece, 16));
      else return null;
    }
    return groups;
  };
  const head = read(halves[0] as string);
  const tail = halves.length === 2 ? read(halves[1] as string) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * The key an address is limited by: an IPv4 address whole, an IPv6 address as its /64 network (one subscriber owns all of it, so
 * a new address from the same network is not a new visitor). An IPv4 address in IPv6 clothes is the IPv4 address. Text that is
 * not an address is kept as it stands.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6] as number;
    const lo = groups[7] as number;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `v6/64:${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}`;
}

/**
 * Turns a phone, an address or a nickname into a key of the limiter: a keyed hash, so the memory of the process holds no
 * contact data. Without a secret each call of the factory makes its own random one (keys do not survive a restart).
 */
export function createKeyHasher(secret: string | Buffer = randomBytes(32)): (kind: string, value: string) => string {
  return (kind, value) =>
    `${kind}:${createHmac("sha256", secret).update(`${kind}\0${value}`).digest("hex").slice(0, 32)}`;
}
