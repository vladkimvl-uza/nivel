import { describe, expect, it } from "vitest";
import { clientIp, createKeyHasher } from "./client-ip.ts";

const headers = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("takes the address the proxy wrote first", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(headers({ "x-forwarded-for": " 203.0.113.7 " }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip and then to nothing", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(headers({}))).toBeNull();
  });

  it("takes an IPv6 address too", () => {
    expect(clientIp(headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("does not take text that is not an address", () => {
    expect(clientIp(headers({ "x-forwarded-for": "<script>alert(1)</script>" }))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "a".repeat(200) }))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "unknown" }))).toBeNull();
  });
});

describe("createKeyHasher", () => {
  it("makes the same key for the same text and a different one for another kind or text", () => {
    const hash = createKeyHasher("secret-one");
    expect(hash("phone", "+998901234567")).toBe(hash("phone", "+998901234567"));
    expect(hash("phone", "+998901234567")).not.toBe(hash("ip", "+998901234567"));
    expect(hash("phone", "+998901234567")).not.toBe(hash("phone", "+998901234568"));
  });

  it("depends on the secret and never contains the text", () => {
    const a = createKeyHasher("secret-one")("ip", "203.0.113.7");
    const b = createKeyHasher("secret-two")("ip", "203.0.113.7");
    expect(a).not.toBe(b);
    expect(a).not.toContain("203.0.113.7");
    expect(a).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("makes a random secret of its own when none is given", () => {
    const a = createKeyHasher()("ip", "x");
    const b = createKeyHasher()("ip", "x");
    expect(a).not.toBe(b);
  });
});
