import { describe, expect, it } from "vitest";
import { clientIp, createKeyHasher, ipKey } from "./client-ip.ts";

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

describe("ipKey", () => {
  it("keeps an IPv4 address whole", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("reduces an IPv6 address to its /64 network: one subscriber owns the whole of it", () => {
    const a = ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe(ipKey("2001:0db8:0001:0002:1:2:3:4"));
    expect(a).not.toBe(ipKey("2001:db8:1:3:aaaa:bbbb:cccc:dddd"));
  });

  it("reads the short forms of IPv6", () => {
    expect(ipKey("2001:db8::1")).toBe(ipKey("2001:db8:0:0:ffff::9"));
    expect(ipKey("::1")).toBe(ipKey("0:0:0:0:0:0:0:1"));
    expect(ipKey("2001:db8:5:6::")).toBe(ipKey("2001:db8:5:6:7:8:9:a"));
    expect(ipKey("::")).toBe(ipKey("0:0:0:0:1:2:3:4"));
  });

  it("treats an IPv4 address in IPv6 clothes as the IPv4 address", () => {
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("keeps text it cannot read, so that it is limited as it stands", () => {
    expect(ipKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(ipKey("zz::1")).toBe("zz::1");
    expect(ipKey("1::2::3")).toBe("1::2::3");
  });
});
