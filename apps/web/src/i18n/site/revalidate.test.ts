import { describe, expect, it, vi } from "vitest";
import {
  handleRevalidate,
  MAX_BODY_BYTES,
  MAX_TAGS,
  REVALIDATE_MAX_AGE_MS,
  signRevalidate,
  verifyRevalidate,
} from "./revalidate.ts";

const KEY = "k".repeat(40); // gitleaks:allow test key, not a secret
const NOW = 1_800_000_000_000;

function request(
  body: string,
  o: { key?: string; at?: number; signature?: string; headers?: Record<string, string> } = {},
) {
  const at = o.at ?? NOW;
  const headers = new Headers({
    "content-type": "application/json",
    "x-nivel-timestamp": String(at),
    "x-nivel-signature": o.signature ?? signRevalidate(o.key ?? KEY, at, body),
    ...o.headers,
  });
  return new Request("http://localhost/api/internal/revalidate", { method: "POST", headers, body });
}

describe("signRevalidate", () => {
  it("is the hex HMAC-SHA256 of <timestamp>.<body> (the same bytes the admin panel and the worker sign)", () => {
    const sig = signRevalidate(KEY, 1700000000000, '{"tags":["fee"]}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(signRevalidate(KEY, "1700000000000", '{"tags":["fee"]}'));
    expect(sig).not.toBe(signRevalidate(KEY, 1700000000001, '{"tags":["fee"]}'));
    expect(sig).not.toBe(signRevalidate(KEY, 1700000000000, '{"tags":["content"]}'));
    expect(sig).not.toBe(signRevalidate(`${KEY}x`, 1700000000000, '{"tags":["fee"]}'));
  });

  it("matches a vector computed outside of Node (Python hmac)", () => {
    expect(signRevalidate(KEY, "1700000000000", "{}")).toBe(
      "ed494f0a89af7a177587c7e4b917abffbdbc34cc1f788bd97755f6f2259e2950",
    );
  });
});

describe("verifyRevalidate", () => {
  const body = '{"tags":["fee"]}';
  const base = { key: KEY, timestamp: String(NOW), body, now: NOW };

  it("takes a fresh request signed with the key", () => {
    expect(verifyRevalidate({ ...base, signature: signRevalidate(KEY, NOW, body) })).toBe("ok");
  });

  it("takes an upper-case signature", () => {
    expect(verifyRevalidate({ ...base, signature: signRevalidate(KEY, NOW, body).toUpperCase() })).toBe("ok");
  });

  it("refuses a body that was changed after signing", () => {
    const signature = signRevalidate(KEY, NOW, body);
    expect(verifyRevalidate({ ...base, body: '{"tags":["content"]}', signature })).toBe("bad_signature");
  });

  it("refuses another key, a short signature, a non-hex signature and an empty one", () => {
    expect(verifyRevalidate({ ...base, signature: signRevalidate("z".repeat(40), NOW, body) })).toBe("bad_signature");
    expect(verifyRevalidate({ ...base, signature: "abcd" })).toBe("bad_signature");
    expect(verifyRevalidate({ ...base, signature: "g".repeat(64) })).toBe("bad_signature");
    expect(verifyRevalidate({ ...base, signature: "" })).toBe("bad_signature");
  });

  it("refuses a request older than five minutes and one that comes from the future", () => {
    expect(REVALIDATE_MAX_AGE_MS).toBe(5 * 60_000);
    const at = NOW - REVALIDATE_MAX_AGE_MS - 1;
    expect(verifyRevalidate({ ...base, timestamp: String(at), signature: signRevalidate(KEY, at, body) })).toBe(
      "stale",
    );
    const ahead = NOW + REVALIDATE_MAX_AGE_MS + 1;
    expect(verifyRevalidate({ ...base, timestamp: String(ahead), signature: signRevalidate(KEY, ahead, body) })).toBe(
      "stale",
    );
  });

  it("takes a request exactly five minutes old", () => {
    const at = NOW - REVALIDATE_MAX_AGE_MS;
    expect(verifyRevalidate({ ...base, timestamp: String(at), signature: signRevalidate(KEY, at, body) })).toBe("ok");
  });

  it("refuses a timestamp that is not milliseconds in digits", () => {
    for (const timestamp of ["", "abc", "-1", "1.5", "1e12", "12345678901234567", " 1"]) {
      expect(verifyRevalidate({ ...base, timestamp, signature: signRevalidate(KEY, timestamp, body) })).toBe(
        "bad_timestamp",
      );
    }
  });

  it("checks the signature before the age: a stale request with a wrong signature is a bad signature", () => {
    const at = NOW - 10 * 60_000;
    expect(verifyRevalidate({ ...base, timestamp: String(at), signature: "0".repeat(64) })).toBe("bad_signature");
  });
});

describe("handleRevalidate", () => {
  const deps = () => ({ key: KEY, now: () => NOW, revalidate: vi.fn() });

  it("revalidates the tags of a signed request and answers them back", async () => {
    const d = deps();
    const res = await handleRevalidate(request('{"tags":["fee","content"]}'), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tags: ["fee", "content"] });
    expect(d.revalidate.mock.calls).toEqual([["fee"], ["content"]]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a request with a wrong signature without touching the cache", async () => {
    const d = deps();
    const res = await handleRevalidate(request('{"tags":["fee"]}', { signature: "0".repeat(64) }), d);
    expect(res.status).toBe(401);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("refuses a request signed with another key", async () => {
    const d = deps();
    const res = await handleRevalidate(request('{"tags":["fee"]}', { key: "x".repeat(40) }), d);
    expect(res.status).toBe(401);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("refuses a stale request", async () => {
    const d = deps();
    const res = await handleRevalidate(request('{"tags":["fee"]}', { at: NOW - 6 * 60_000 }), d);
    expect(res.status).toBe(401);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("refuses a request without the headers", async () => {
    const d = deps();
    const bare = new Request("http://localhost/api/internal/revalidate", { method: "POST", body: '{"tags":["fee"]}' });
    expect((await handleRevalidate(bare, d)).status).toBe(401);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("answers 503 and does nothing when the site has no key: an open door is worse than a closed one", async () => {
    const d = { ...deps(), key: undefined };
    const res = await handleRevalidate(request('{"tags":["fee"]}'), d);
    expect(res.status).toBe(503);
    expect(d.revalidate).not.toHaveBeenCalled();
    expect((await handleRevalidate(request('{"tags":["fee"]}'), { ...d, key: "short" })).status).toBe(503);
  });

  it.each([
    ["not json", "{"],
    ["no tags", "{}"],
    ["tags is not a list", '{"tags":"fee"}'],
    ["an empty list", '{"tags":[]}'],
    ["a tag that is not text", '{"tags":[1]}'],
    ["a tag with a space", '{"tags":["a b"]}'],
    ["a tag that is too long", `{"tags":["${"a".repeat(65)}"]}`],
    ["an empty tag", '{"tags":[""]}'],
    ["a list, not an object", '["fee"]'],
    ["null", "null"],
  ])("answers 400 to %s (signed correctly)", async (_name, body) => {
    const d = deps();
    const res = await handleRevalidate(request(body), d);
    expect(res.status).toBe(400);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("takes at most the number of tags the worker sends", async () => {
    expect(MAX_TAGS).toBe(20);
    const d = deps();
    const many = JSON.stringify({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) });
    expect((await handleRevalidate(request(many), d)).status).toBe(400);
    const ok = JSON.stringify({ tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`) });
    expect((await handleRevalidate(request(ok), d)).status).toBe(200);
    expect(d.revalidate).toHaveBeenCalledTimes(MAX_TAGS);
  });

  it("repeats a tag once", async () => {
    const d = deps();
    const res = await handleRevalidate(request('{"tags":["fee","fee"]}'), d);
    expect(await res.json()).toEqual({ ok: true, tags: ["fee"] });
    expect(d.revalidate).toHaveBeenCalledTimes(1);
  });

  it("answers 413 to a body above the limit before it checks anything else", async () => {
    const d = deps();
    const big = `{"tags":["fee"],"pad":"${"x".repeat(MAX_BODY_BYTES)}"}`;
    const res = await handleRevalidate(request(big), d);
    expect(res.status).toBe(413);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("answers 413 by the declared length too, without reading the body", async () => {
    const d = deps();
    const res = await handleRevalidate(
      request('{"tags":["fee"]}', { headers: { "content-length": String(MAX_BODY_BYTES + 1) } }),
      d,
    );
    expect(res.status).toBe(413);
  });

  it("does not let a failing cache leak its message", async () => {
    const d = {
      ...deps(),
      revalidate: vi.fn(() => {
        throw new Error("secret path /srv/cache");
      }),
    };
    const res = await handleRevalidate(request('{"tags":["fee"]}'), d);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });
});
