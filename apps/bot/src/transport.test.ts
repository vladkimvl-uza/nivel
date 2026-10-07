// The real transport of grammY against a mocked api.telegram.org (MSW, NETWORK_GUARD): what the bot sends at the start
// travels as JSON the Bot API accepts, and nothing else leaves the process.
import { network } from "@nivel/testing/setup-unit";
import { Bot } from "grammy";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { configureBot } from "./configure.ts";
import { BOT_INFO } from "./testing/fake-telegram.ts";

const TOKEN = "123456:TEST-token-of-the-transport-tests"; // gitleaks:allow made-up value, never a real bot token

interface Seen {
  method: string;
  body: Record<string, unknown>;
}

function mockTelegram(answer: (method: string) => Response | undefined = () => undefined): Seen[] {
  const seen: Seen[] = [];
  network.use(
    http.post(`https://api.telegram.org/bot${TOKEN}/:method`, async ({ request, params }) => {
      const method = String(params.method);
      seen.push({ method, body: (await request.json()) as Record<string, unknown> });
      return answer(method) ?? HttpResponse.json({ ok: true, result: true });
    }),
  );
  return seen;
}

describe("the commands and the descriptions through the real client", () => {
  it("go to the Bot API as JSON: the default first, then Uzbek and Russian, with the language codes", async () => {
    const seen = mockTelegram();
    await configureBot(new Bot(TOKEN, { botInfo: BOT_INFO }).api);
    expect(seen.map((s) => [s.method, s.body.language_code])).toEqual([
      ["setMyCommands", undefined],
      ["setMyShortDescription", undefined],
      ["setMyDescription", undefined],
      ["setMyCommands", "uz"],
      ["setMyShortDescription", "uz"],
      ["setMyDescription", "uz"],
      ["setMyCommands", "ru"],
      ["setMyShortDescription", "ru"],
      ["setMyDescription", "ru"],
    ]);
    const ru = seen.find((s) => s.method === "setMyCommands" && s.body.language_code === "ru");
    expect(ru?.body.commands).toEqual([
      { command: "start", description: "Начать" },
      { command: "language", description: "Сменить язык" },
      { command: "order", description: "Мой заказ" },
      { command: "support", description: "Связь и часы работы" },
      { command: "terms", description: "Условия работы" },
      { command: "privacy", description: "Политика конфиденциальности" },
      { command: "stop", description: "Отписаться от рассылок" },
    ]);
  });

  it("a refusal of Telegram is an error the caller sees (the process logs it and goes on)", async () => {
    mockTelegram(() =>
      HttpResponse.json(
        { ok: false, error_code: 429, description: "Too Many Requests: retry after 5" },
        { status: 429 },
      ),
    );
    await expect(configureBot(new Bot(TOKEN, { botInfo: BOT_INFO }).api)).rejects.toThrow(/Too Many Requests/);
  });

  it("a call nobody mocked does not leave the process: the guard records it", async () => {
    await expect(new Bot("999:unmocked", { botInfo: BOT_INFO }).api.sendMessage(1, "x")).rejects.toThrow();
    expect(network.takeViolations()).toEqual(["POST https://api.telegram.org/bot999:unmocked/sendMessage"]);
  });
});
