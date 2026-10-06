import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  openSecret,
  parseDataKey,
  sealSecret,
  sha256Hex,
  type TotpBundle,
} from "./secrets.ts";

const key = parseDataKey(randomBytes(32).toString("base64"));

describe("sealed TOTP bundle (AES-256-GCM)", () => {
  const bundle: TotpBundle = { v: 1, secret: "GEZDGNBVGY3TQOJQ", recovery: [sha256Hex("a"), sha256Hex("b")] };

  it("round trips", () => {
    const sealed = sealSecret(bundle, key, "user-1");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(openSecret(sealed, key, "user-1")).toEqual(bundle);
  });

  it("is different every time (fresh IV) and never shows the secret", () => {
    const a = sealSecret(bundle, key, "user-1");
    const b = sealSecret(bundle, key, "user-1");
    expect(a).not.toBe(b);
    expect(a).not.toContain("GEZDGNBV");
  });

  it("is bound to the user: a blob copied to another account does not open", () => {
    const sealed = sealSecret(bundle, key, "user-1");
    expect(openSecret(sealed, key, "user-2")).toBeNull();
  });

  it("does not open with another key, after tampering, or when it is not a sealed value", () => {
    const sealed = sealSecret(bundle, key, "user-1");
    expect(openSecret(sealed, parseDataKey(randomBytes(32).toString("base64")), "user-1")).toBeNull();
    const parts = sealed.split(".");
    parts[3] = `${parts[3]?.slice(0, -2)}AA`;
    expect(openSecret(parts.join("."), key, "user-1")).toBeNull();
    expect(openSecret("", key, "user-1")).toBeNull();
    expect(openSecret("v2.a.b.c", key, "user-1")).toBeNull();
    expect(openSecret("garbage", key, "user-1")).toBeNull();
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => parseDataKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseDataKey("")).toThrow(/32 bytes/);
  });
});

describe("recovery codes", () => {
  it("makes ten distinct codes without look-alike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  });

  it("is typed with any case, spaces or without the hyphen", () => {
    const [code] = generateRecoveryCodes();
    const typed = (code ?? "").toUpperCase().replace("-", "  ");
    expect(normalizeRecoveryCode(typed)).toBe(code);
    expect(normalizeRecoveryCode((code ?? "").replace("-", ""))).toBe(code);
    expect(hashRecoveryCode(typed)).toBe(hashRecoveryCode(code ?? ""));
    expect(hashRecoveryCode("zzzzz-zzzzz")).not.toBe(hashRecoveryCode(code ?? ""));
  });

  it("hashes to sha256 hex", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
