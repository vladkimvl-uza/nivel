import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotp, newTotpSecret, otpauthUri, verifyTotp } from "./totp.ts";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890", 8 digits.
const rfcKey = new TextEncoder().encode("12345678901234567890");
const rfcVectors: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [seconds, code] of rfcVectors) {
      expect(generateTotp(rfcKey, new Date(seconds * 1000), { digits: 8 })).toBe(code);
    }
  });

  it("makes six digits by default and keeps leading zeros", () => {
    expect(generateTotp(rfcKey, new Date(1111111109 * 1000))).toBe("081804");
  });

  it("base32 round trips and ignores spaces, case and padding", () => {
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(new TextDecoder().decode(base32Decode("mzxw 6ytb oi======"))).toBe("foobar");
    const random = newTotpSecret();
    expect(random.length).toBe(20);
    expect(base32Decode(base32Encode(random))).toEqual(random);
    expect(() => base32Decode("not*base32")).toThrow(/base32/);
  });

  it("verifies the current code and one period either side, no more", () => {
    const now = new Date(1_800_000_000_000);
    const at = (offsetSeconds: number) => generateTotp(rfcKey, new Date(now.getTime() + offsetSeconds * 1000));
    expect(verifyTotp(rfcKey, at(0), now)).toBe(true);
    expect(verifyTotp(rfcKey, at(-30), now)).toBe(true);
    expect(verifyTotp(rfcKey, at(30), now)).toBe(true);
    expect(verifyTotp(rfcKey, at(-90), now)).toBe(false);
    expect(verifyTotp(rfcKey, at(90), now)).toBe(false);
  });

  it("refuses anything that is not six digits", () => {
    const now = new Date(1_800_000_000_000);
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "１２３４５６", " 123456"]) {
      expect(verifyTotp(rfcKey, bad, now)).toBe(false);
    }
  });

  it("accepts a code typed with a space in the middle, as authenticator apps show it", () => {
    const now = new Date(1_800_000_000_000);
    const code = generateTotp(rfcKey, now);
    expect(verifyTotp(rfcKey, `${code.slice(0, 3)} ${code.slice(3)}`, now, { normalize: true })).toBe(true);
  });

  it("builds an otpauth URI an authenticator app understands", () => {
    const uri = otpauthUri({ secret: rfcKey, account: "owner@nivel.uz", issuer: "Nivel admin" });
    expect(uri).toBe(
      "otpauth://totp/Nivel%20admin:owner%40nivel.uz?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Nivel%20admin&algorithm=SHA1&digits=6&period=30",
    );
  });
});
