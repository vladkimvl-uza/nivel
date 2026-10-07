import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INIT_DATA_MAX_AGE_SECONDS, verifyInitData } from "./init-data.ts";

const TOKEN = "123456:TEST-token-for-unit-tests"; // gitleaks:allow made-up value, never a real bot token
const NOW = new Date("2026-10-20T10:00:00Z");
const authDate = (agoSeconds: number) => Math.floor(NOW.getTime() / 1000) - agoSeconds;

/** What Telegram does: fields but `hash` sorted by name, joined with "\n"; secret = HMAC("WebAppData", token). */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const user = JSON.stringify({ id: 7100000001, first_name: "Ali", username: "ali_uz", language_code: "uz" });
const fields = (ago = 60) => ({ auth_date: String(authDate(ago)), query_id: "AAH-test", user });
const view = { now: NOW, maxAgeSeconds: INIT_DATA_MAX_AGE_SECONDS.view };

describe("verifyInitData", () => {
  it("accepts data signed with the bot token and returns the user and the time", () => {
    const r = verifyInitData(sign(fields()), TOKEN, view);
    expect(r).toMatchObject({ ok: true, user: { id: 7100000001, username: "ali_uz" } });
    expect(r.ok && r.authDate.toISOString()).toBe(new Date(authDate(60) * 1000).toISOString());
  });

  it("returns the start parameter when the signed data has one", () => {
    const r = verifyInitData(sign({ ...fields(), start_param: "order_NV-2026-0001" }), TOKEN, view);
    expect(r).toMatchObject({ ok: true, startParam: "order_NV-2026-0001" });
  });

  it("refuses data signed with another token", () => {
    expect(verifyInitData(sign(fields(), "999:other"), TOKEN, view)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("refuses a field changed after signing (another user id)", () => {
    const signed = new URLSearchParams(sign(fields()));
    signed.set("user", user.replace("7100000001", "6001000001"));
    expect(verifyInitData(signed.toString(), TOKEN, view)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("refuses a field added after signing", () => {
    const signed = `${sign(fields())}&start_param=order_NV-2026-0001`;
    expect(verifyInitData(signed, TOKEN, view)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("refuses a field that stands twice", () => {
    const signed = `${sign(fields())}&query_id=other`;
    expect(verifyInitData(signed, TOKEN, view)).toEqual({ ok: false, reason: "malformed" });
  });

  it("limits the age: 24 hours to view, 1 hour to send a request or an acceptance", () => {
    expect(INIT_DATA_MAX_AGE_SECONDS).toEqual({ view: 86_400, action: 3_600 });
    const old = sign(fields(2 * 3600));
    expect(verifyInitData(old, TOKEN, view).ok).toBe(true);
    expect(verifyInitData(old, TOKEN, { now: NOW, maxAgeSeconds: INIT_DATA_MAX_AGE_SECONDS.action })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyInitData(sign(fields(25 * 3600)), TOKEN, view)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a time from the future (beyond a minute of clock skew)", () => {
    expect(verifyInitData(sign(fields(-3600)), TOKEN, view)).toEqual({ ok: false, reason: "expired" });
    expect(verifyInitData(sign(fields(-30)), TOKEN, view).ok).toBe(true);
  });

  it("refuses data without hash, without auth_date or without a user", () => {
    expect(verifyInitData("auth_date=1&user=%7B%7D", TOKEN, view)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInitData(sign({ user }), TOKEN, view)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInitData(sign({ auth_date: String(authDate(5)) }), TOKEN, view)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses a user that is not JSON with a positive whole id", () => {
    const bads = [
      "not json",
      "[]",
      JSON.stringify({ id: "7" }),
      JSON.stringify({ id: -1 }),
      JSON.stringify({ id: 1.5 }),
    ];
    for (const bad of bads) {
      const signed = sign({ auth_date: String(authDate(5)), user: bad });
      expect(verifyInitData(signed, TOKEN, view)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("refuses junk input and an empty token without throwing", () => {
    for (const junk of ["", "hash=", "%%%", "a=1&a=2&hash=zz"]) {
      expect(verifyInitData(junk, TOKEN, view).ok).toBe(false);
    }
    expect(verifyInitData(undefined as never, TOKEN, view).ok).toBe(false);
    expect(verifyInitData(sign(fields()), "", view)).toEqual({ ok: false, reason: "no_token" });
  });

  it("refuses a hash of the wrong length or alphabet", () => {
    for (const hash of ["abcd", "z".repeat(64)]) {
      const signed = new URLSearchParams(sign(fields()));
      signed.set("hash", hash);
      expect(verifyInitData(signed.toString(), TOKEN, view)).toEqual({ ok: false, reason: "bad_hash" });
    }
  });
});
