// Check of Mini App initData (ARCHITECTURE 7.3, `node:crypto`): the fields but `hash` sorted by name and joined with
// "\n"; secret = HMAC_SHA256(key = "WebAppData", message = bot token); the hash is compared in constant time.
// `initDataUnsafe` is never used: only the string that has passed this check names a person.
import { createHmac, timingSafeEqual } from "node:crypto";

/** auth_date must be at most this old: a day to look, an hour to send a request or an acceptance. */
export const INIT_DATA_MAX_AGE_SECONDS = { view: 86_400, action: 3_600 } as const;
/** Clock skew between Telegram and this server that is forgiven. */
const SKEW_SECONDS = 60;

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult =
  | { ok: true; user: InitDataUser; authDate: Date; startParam?: string }
  | { ok: false; reason: "no_token" | "malformed" | "bad_hash" | "expired" };

const HEX64 = /^[0-9a-f]{64}$/;

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { now: Date; maxAgeSeconds: number },
): InitDataResult {
  if (typeof botToken !== "string" || botToken === "") return { ok: false, reason: "no_token" };
  if (typeof initData !== "string" || initData === "") return { ok: false, reason: "malformed" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (hash === null) return { ok: false, reason: "malformed" };
  // A repeated field would let two readers pick different values: every name must stand once.
  const names = [...params.keys()];
  if (new Set(names).size !== names.length) return { ok: false, reason: "malformed" };

  const check = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const given = HEX64.test(hash) ? Buffer.from(hash, "hex") : null;
  if (given === null || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_hash" };

  // Signed, so the shape below is Telegram's; it is still read strictly.
  const rawDate = params.get("auth_date");
  const rawUser = params.get("user");
  if (rawDate === null || !/^\d{1,12}$/.test(rawDate) || rawUser === null) return { ok: false, reason: "malformed" };
  let user: unknown;
  try {
    user = JSON.parse(rawUser);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const id = (user as { id?: unknown } | null)?.id;
  if (
    user === null ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    !Number.isSafeInteger(id) ||
    (id as number) <= 0
  ) {
    return { ok: false, reason: "malformed" };
  }
  const authDate = new Date(Number(rawDate) * 1000);
  const ageSeconds = (opts.now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > opts.maxAgeSeconds || ageSeconds < -SKEW_SECONDS) return { ok: false, reason: "expired" };
  const startParam = params.get("start_param");
  return { ok: true, user: user as InitDataUser, authDate, ...(startParam === null ? {} : { startParam }) };
}
