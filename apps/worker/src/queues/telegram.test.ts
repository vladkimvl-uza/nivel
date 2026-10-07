import { describe, expect, it } from "vitest";
import { createTelegramGateway, disabledTelegram, TelegramError } from "./telegram.ts";
import { fetchWithHangingBody } from "./test-support/fakes.ts";

const TOKEN = "123456789:AAE-test-token-not-a-real-one-0123456789"; // gitleaks:allow fake token of the unit test

function fakeFetch(answer: { status: number; body: unknown; headers?: Record<string, string> } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("createTelegramGateway: a server that stops in the middle of the answer", () => {
  it("gives up after the timeout, whole request included the body", async () => {
    const hang = fetchWithHangingBody();
    const tg = createTelegramGateway({ token: TOKEN, fetch: hang.impl, timeoutMs: 30 });
    const error = await tg.sendMessage({ chatId: 5, text: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect((error as TelegramError).message).toContain("timeout");
  }, 3000);
});

describe("createTelegramGateway.sendMessage", () => {
  it("posts the text to the chat and answers the id of the message", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { ok: true, result: { message_id: 77 } } });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    expect(tg.enabled).toBe(true);
    await expect(tg.sendMessage({ chatId: 555, text: "Salom" })).resolves.toEqual({ messageId: 77 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]?.init.method).toBe("POST");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ chat_id: 555, text: "Salom", link_preview_options: { is_disabled: true } });
  });

  it("sends to a topic of a forum group", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { ok: true, result: { message_id: 1 } } });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    await tg.sendMessage({ chatId: -100123, text: "x", threadId: 42 });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ chat_id: -100123, message_thread_id: 42 });
  });

  it("cuts a text that is longer than Telegram takes (4096 characters)", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { ok: true, result: { message_id: 1 } } });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    await tg.sendMessage({ chatId: 1, text: "я".repeat(5000) });
    const sent = JSON.parse(String(calls[0]?.init.body)).text as string;
    expect(sent.length).toBe(4096);
    expect(sent.endsWith("…")).toBe(true);
  });

  it("turns a refusal into a TelegramError with the status, the code and the pause Telegram asks for", async () => {
    const { impl } = fakeFetch({
      status: 429,
      body: {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 7",
        parameters: { retry_after: 7 },
      },
    });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    const error = await tg.sendMessage({ chatId: 1, text: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect(error).toMatchObject({ status: 429, retryAfterSec: 7 });
  });

  it("keeps the token out of the error: an error is logged and written to ops.app_errors", async () => {
    const { impl } = fakeFetch({ status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    const error = (await tg.sendMessage({ chatId: 1, text: "x" }).catch((e) => e)) as TelegramError;
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain("AAE-test");
    expect(error.status).toBe(401);
  });

  it("makes a network failure a TelegramError without a status (to be retried) and does not leak the token either", async () => {
    const { impl } = fakeFetch(new Error(`connect ECONNREFUSED api.telegram.org/bot${TOKEN}/sendMessage`));
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    const error = (await tg.sendMessage({ chatId: 1, text: "x" }).catch((e) => e)) as TelegramError;
    expect(error).toBeInstanceOf(TelegramError);
    expect(error.status).toBeNull();
    expect(error.message).not.toContain(TOKEN);
  });

  it("gives up on a call that lasts longer than the timeout", async () => {
    const impl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl, timeoutMs: 20 });
    const error = (await tg.sendMessage({ chatId: 1, text: "x" }).catch((e) => e)) as TelegramError;
    expect(error).toBeInstanceOf(TelegramError);
    expect(error.status).toBeNull();
  });

  it("reads a body that is not JSON as a failure", async () => {
    const impl = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    const error = (await tg.sendMessage({ chatId: 1, text: "x" }).catch((e) => e)) as TelegramError;
    expect(error.status).toBe(502);
  });
});

describe("createTelegramGateway.getWebhookInfo", () => {
  it("reads the url and the last error of the webhook", async () => {
    const { impl, calls } = fakeFetch({
      status: 200,
      body: {
        ok: true,
        result: {
          url: "https://nivel.uz/tg/abc",
          last_error_date: 1_760_000_000,
          last_error_message: "Wrong response",
        },
      },
    });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    await expect(tg.getWebhookInfo()).resolves.toEqual({
      url: "https://nivel.uz/tg/abc",
      lastErrorDate: 1_760_000_000,
      lastErrorMessage: "Wrong response",
    });
    expect(calls[0]?.url.endsWith("/getWebhookInfo")).toBe(true);
  });

  it("answers null for the fields Telegram leaves out", async () => {
    const { impl } = fakeFetch({ status: 200, body: { ok: true, result: { url: "" } } });
    const tg = createTelegramGateway({ token: TOKEN, fetch: impl });
    await expect(tg.getWebhookInfo()).resolves.toEqual({ url: "", lastErrorDate: null, lastErrorMessage: null });
  });
});

describe("disabledTelegram (no BOT_TOKEN)", () => {
  it("is not enabled and refuses to send: the relay skips the row before it comes to this", async () => {
    expect(disabledTelegram.enabled).toBe(false);
    await expect(disabledTelegram.sendMessage({ chatId: 1, text: "x" })).rejects.toThrow(/BOT_TOKEN/);
    await expect(disabledTelegram.getWebhookInfo()).rejects.toThrow(/BOT_TOKEN/);
  });
});
