import { GrammyError, HttpError } from "grammy";
import { describe, expect, it } from "vitest";
import { safeErr } from "./safe-err.ts";

const TOKEN = "123456789:AAH-made_up_token_for_the_test_0123456"; // gitleaks:allow made-up value, never a real bot token

describe("what the log keeps of an error", () => {
  it("an error of Telegram keeps the method, the code and the words, and nothing of the request", () => {
    const err = new GrammyError(
      "Call to 'setWebhook' failed!",
      { ok: false, error_code: 400, description: "Bad Request: bad webhook" },
      "setWebhook",
      { url: "https://x.test/tg/abc", secret_token: "very-secret-value", text: "address: Chilonzor 1" },
    );
    const out = JSON.stringify(safeErr(err));
    expect(out).toContain("setWebhook");
    expect(out).toContain("400");
    expect(out).toContain("Bad Request: bad webhook");
    expect(out).not.toContain("very-secret-value");
    expect(out).not.toContain("Chilonzor");
  });

  it("the token of the bot is hidden in the words of a network error", () => {
    const err = new HttpError(
      `Network request for 'getUpdates' failed! (https://api.telegram.org/bot${TOKEN}/getUpdates)`,
      new Error(`bot${TOKEN}`),
    );
    expect(JSON.stringify(safeErr(err))).not.toContain(TOKEN);
  });

  it("another error keeps its type, its words and its stack, with the token hidden", () => {
    const err = new TypeError(`bad ${`bot${TOKEN}`}`);
    const out = safeErr(err) as { type: string; message: string; stack: string };
    expect(out.type).toBe("TypeError");
    expect(out.message).toBe("bad bot<token>");
    expect(out.stack).not.toContain(TOKEN);
  });

  it("what is not an error passes without a failure", () => {
    expect(() => safeErr("just text")).not.toThrow();
    expect(() => safeErr(undefined)).not.toThrow();
  });
});
