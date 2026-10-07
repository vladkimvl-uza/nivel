import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import {
  handleRevalidate,
  REVALIDATE_MAX_AGE_MS,
  REVALIDATE_PATH,
  signRevalidate,
  verifyRevalidate,
} from "./revalidate.ts";

const KEY = "unit-test-key-0123456789-0123456789-0123456789"; // gitleaks:allow fake key of the unit test

function fakeSite(answer: { status: number } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (answer instanceof Error) throw answer;
    return new Response("{}", { status: answer.status });
  }) as typeof fetch;
  return { impl, calls };
}

function setup(answer: { status: number } | Error = { status: 200 }) {
  const clock = new FakeClock();
  const site = fakeSite(answer);
  const { log, lines } = recordingLogger();
  const deps = {
    fetch: site.impl,
    now: clock.now,
    log,
    settings: { publicBaseUrl: "http://web:3100", revalidateKey: KEY },
  };
  return { deps, clock, site, lines };
}

describe("signRevalidate and verifyRevalidate", () => {
  it("signs <timestamp>.<body> with HMAC-SHA256 and writes the signature as hex", () => {
    const body = '{"tags":["settings","fee"]}';
    const expected = createHmac("sha256", KEY).update(`1760000000000.${body}`).digest("hex");
    expect(signRevalidate(KEY, 1_760_000_000_000, body)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  const now = 1_760_000_000_000;
  const body = '{"tags":["prices"]}';
  const good = () => ({ key: KEY, timestamp: String(now), body, signature: signRevalidate(KEY, now, body), now });

  it("accepts a fresh call with the right signature", () => {
    expect(verifyRevalidate(good())).toBe("ok");
  });

  it("accepts a call up to five minutes old and refuses it after (and refuses one from the future by as much)", () => {
    expect(REVALIDATE_MAX_AGE_MS).toBe(5 * 60_000);
    expect(verifyRevalidate({ ...good(), now: now + REVALIDATE_MAX_AGE_MS })).toBe("ok");
    expect(verifyRevalidate({ ...good(), now: now + REVALIDATE_MAX_AGE_MS + 1 })).toBe("stale");
    expect(verifyRevalidate({ ...good(), now: now - REVALIDATE_MAX_AGE_MS })).toBe("ok");
    expect(verifyRevalidate({ ...good(), now: now - REVALIDATE_MAX_AGE_MS - 1 })).toBe("stale");
  });

  it("refuses a changed body, a changed timestamp, another key and a signature of the wrong shape", () => {
    expect(verifyRevalidate({ ...good(), body: '{"tags":["fee"]}' })).toBe("bad_signature");
    expect(verifyRevalidate({ ...good(), timestamp: String(now + 1) })).toBe("bad_signature");
    expect(verifyRevalidate({ ...good(), key: `${KEY}x` })).toBe("bad_signature");
    expect(verifyRevalidate({ ...good(), signature: "abc" })).toBe("bad_signature");
    expect(verifyRevalidate({ ...good(), signature: "" })).toBe("bad_signature");
  });

  it("refuses a timestamp that is not a number", () => {
    expect(verifyRevalidate({ ...good(), timestamp: "yesterday" })).toBe("bad_timestamp");
    expect(verifyRevalidate({ ...good(), timestamp: "" })).toBe("bad_timestamp");
  });
});

describe("handleRevalidate", () => {
  it("posts the tags to /api/internal/revalidate of the site with a signature over timestamp and body", async () => {
    const t = setup();
    await handleRevalidate(t.deps, { job: "web.revalidate", tags: ["settings", "fee"] });
    expect(t.site.calls).toHaveLength(1);
    const call = t.site.calls[0];
    expect(call?.url).toBe(`http://web:3100${REVALIDATE_PATH}`);
    expect(REVALIDATE_PATH).toBe("/api/internal/revalidate");
    expect(call?.init.method).toBe("POST");
    const body = String(call?.init.body);
    expect(JSON.parse(body)).toEqual({ tags: ["settings", "fee"] });
    const headers = new Headers(call?.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    const timestamp = headers.get("x-nivel-timestamp") as string;
    expect(timestamp).toBe(String(t.clock.ms()));
    expect(
      verifyRevalidate({
        key: KEY,
        timestamp,
        body,
        signature: headers.get("x-nivel-signature") as string,
        now: t.clock.ms(),
      }),
    ).toBe("ok");
  });

  it("signs again with a fresh timestamp on every attempt: a retry after ten minutes is not stale", async () => {
    const t = setup();
    await handleRevalidate(t.deps, { tags: ["prices"] });
    t.clock.advance(10 * 60_000);
    await handleRevalidate(t.deps, { tags: ["prices"] });
    const stamps = t.site.calls.map((c) => new Headers(c.init.headers).get("x-nivel-timestamp"));
    expect(stamps[1]).not.toBe(stamps[0]);
    const second = t.site.calls[1];
    expect(
      verifyRevalidate({
        key: KEY,
        timestamp: stamps[1] as string,
        body: String(second?.init.body),
        signature: new Headers(second?.init.headers).get("x-nivel-signature") as string,
        now: t.clock.ms(),
      }),
    ).toBe("ok");
  });

  it("never puts the key into the log or the error", async () => {
    const t = setup(new Error(`connect ECONNREFUSED web:3100 with ${KEY}`));
    const error = await handleRevalidate(t.deps, { tags: ["fee"] }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).not.toContain(KEY);
    expect(JSON.stringify(t.lines)).not.toContain(KEY);
  });

  it.each([
    ["the site is not reachable", new Error("fetch failed")],
    ["the site answers 502", { status: 502 }],
    ["the site answers 503", { status: 503 }],
    ["the site answers 404 (the route is not deployed yet)", { status: 404 }],
    ["the site answers 429", { status: 429 }],
    ["the site answers 408", { status: 408 }],
  ])("lets pg-boss retry when %s", async (_n, answer) => {
    const t = setup(answer);
    const error = await handleRevalidate(t.deps, { tags: ["fee"] }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
  });

  it.each([400, 401, 403, 422])(
    "refuses for good when the site answers %i: the same request will be refused again",
    async (status) => {
      const t = setup({ status });
      await expect(handleRevalidate(t.deps, { tags: ["fee"] })).rejects.toBeInstanceOf(PermanentJobError);
    },
  );

  it("gives up on a call that hangs", async () => {
    const clock = new FakeClock();
    const { log } = recordingLogger();
    const impl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;
    await expect(
      handleRevalidate(
        {
          fetch: impl,
          now: clock.now,
          log,
          settings: { publicBaseUrl: "http://web:3100", revalidateKey: KEY },
          timeoutMs: 20,
        },
        { tags: ["fee"] },
      ),
    ).rejects.toThrow(/timeout/);
  });

  it("refuses a job without tags, with too many, or with a tag of a strange shape", async () => {
    const t = setup();
    for (const data of [
      {},
      { tags: [] },
      { tags: "fee" },
      { tags: [1] },
      { tags: [""] },
      { tags: ["a b"] },
      { tags: ["x".repeat(65)] },
      { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    ]) {
      await expect(handleRevalidate(t.deps, data)).rejects.toBeInstanceOf(PermanentJobError);
    }
    expect(t.site.calls).toEqual([]);
  });

  it("builds the address of the site from PUBLIC_BASE_URL with or without a slash at the end or a path", async () => {
    const a = setup();
    await handleRevalidate(
      { ...a.deps, settings: { ...a.deps.settings, publicBaseUrl: "https://nivel.uz/" } },
      { tags: ["fee"] },
    );
    expect(a.site.calls[0]?.url).toBe("https://nivel.uz/api/internal/revalidate");
  });
});
