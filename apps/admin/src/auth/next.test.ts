// The session in Next.js: guards of pages and of actions, the cookie, what the journal may know of the caller.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_POLICY, SESSION_COOKIE } from "./policy.ts";
import { ForbiddenError } from "./roles.ts";

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./runtime.ts", () => ({ getRuntime: () => app.current }));
vi.mock("next/headers", async () => (await import("../kit/test-support/fake-app.ts")).nextHeadersMock);
vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("../kit/test-support/fake-app.ts");
  return {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  };
});

const { cookieWrites, createFakeApp, jar, requestHeaders } = await import("../kit/test-support/fake-app.ts");
const next = await import("./next.ts");

let fake: Awaited<ReturnType<typeof createFakeApp>>;
beforeEach(() => {
  fake = createFakeApp();
  app.current = fake.runtime;
});

describe("pages", () => {
  it("a person without a session goes to the sign-in page, one without the right to the page that says so", async () => {
    await expect(next.requireUser()).rejects.toMatchObject({ url: "/sign-in" });
    await fake.signInAs("assistant");
    await expect(next.requireUser(["settings.money.read"])).rejects.toMatchObject({ url: "/forbidden" });
    await expect(next.requireUser(["settings.calendar.read"])).resolves.toMatchObject({ role: "assistant" });
    await expect(next.requireUser()).resolves.toMatchObject({ role: "assistant" });
  });

  it("a cookie with a made-up token is no session", async () => {
    jar.set(SESSION_COOKIE, "x".repeat(43));
    expect(await next.currentUser()).toBeNull();
  });
});

describe("actions", () => {
  it("requireActionUser throws ForbiddenError instead of redirecting", async () => {
    await expect(next.requireActionUser("account.self")).rejects.toBeInstanceOf(ForbiddenError);
    await fake.signInAs("translator");
    await expect(next.requireActionUser("account.self")).resolves.toMatchObject({ role: "translator" });
    await expect(next.requireActionUser("catalog.write")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("guardAction gives the person or nothing, and writes the refusal with the hash of the address", async () => {
    requestHeaders.set("x-real-ip", "10.66.0.9");
    expect(await next.guardAction("journal.read", "journal.read", "ops.audit_log")).toBeNull();
    expect(fake.audit.at(-1)).toMatchObject({
      actor: "anonymous",
      action: "journal.read.denied",
      ipHash: "hash(10.66.0.9)",
    });
    await fake.signInAs("owner");
    expect(await next.guardAction("journal.read", "journal.read", "ops.audit_log")).toMatchObject({ role: "owner" });
  });

  it("explains a refusal in Russian, and only a refusal", () => {
    expect(next.forbiddenMessage(new ForbiddenError("assistant", "x"))).toBe("Недостаточно прав для этого действия.");
    expect(next.forbiddenMessage(new Error("boom"))).toBeNull();
  });
});

describe("the cookie and the address", () => {
  it("startSession writes the token, endSession gives it back and removes it", async () => {
    await next.startSession("t".repeat(43));
    expect(jar.get(SESSION_COOKIE)).toBe("t".repeat(43));
    expect(await next.endSession()).toBe("t".repeat(43));
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await next.endSession()).toBeUndefined();
  });

  it("the cookie lives as long as a session can (the server ends it after 8 hours of silence), not 8 hours from the sign-in", async () => {
    await next.startSession("t".repeat(43));
    expect(cookieWrites.at(-1)?.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: AUTH_POLICY.absoluteDays * 24 * 3600,
    });
  });

  it("the cookie is removed with the same attributes it was set with, Secure included: a __Host- cookie needs them", async () => {
    await next.startSession("t".repeat(43));
    await next.endSession();
    expect(cookieWrites.at(-1)).toMatchObject({
      name: SESSION_COOKIE,
      value: "",
      options: { maxAge: 0, path: "/", secure: true, httpOnly: true, sameSite: "strict" },
    });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("takes the first address of X-Forwarded-For, then X-Real-IP; knows nothing without them; cuts a long User-Agent", async () => {
    requestHeaders.set("x-forwarded-for", "10.66.0.1, 172.17.0.2");
    requestHeaders.set("user-agent", "u".repeat(500));
    const info = await next.requestInfo();
    expect(info.ipHash).toBe("hash(10.66.0.1)");
    expect(info.ua).toHaveLength(300);
    requestHeaders.delete("x-forwarded-for");
    requestHeaders.set("x-real-ip", "10.66.0.2");
    expect((await next.requestInfo()).ipHash).toBe("hash(10.66.0.2)");
    requestHeaders.delete("x-real-ip");
    requestHeaders.delete("user-agent");
    expect(await next.requestInfo()).toEqual({ ipHash: null, ua: null });
  });
});
