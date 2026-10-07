import { describe, expect, it } from "vitest";
import { BOT_COMMANDS, botCommands, botProfile } from "./commands.ts";

describe("the commands of the bot", () => {
  it("are the seven of the architecture, in that order", () => {
    expect(BOT_COMMANDS).toEqual(["start", "language", "order", "support", "terms", "privacy", "stop"]);
  });

  it.each(["uz", "ru"] as const)("have a description in %s that Telegram accepts", (lang) => {
    const list = botCommands(lang);
    expect(list.map((c) => c.command)).toEqual([...BOT_COMMANDS]);
    for (const c of list) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThanOrEqual(3);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("differ between the languages", () => {
    expect(botCommands("uz")[0]?.description).toBe("Boshlash");
    expect(botCommands("ru")[0]?.description).toBe("Начать");
  });

  it.each(["uz", "ru"] as const)("have a profile in %s within the limits of Telegram", (lang) => {
    const p = botProfile(lang);
    expect(p.shortDescription.length).toBeLessThanOrEqual(120);
    expect(p.description.length).toBeLessThanOrEqual(512);
    expect(p.shortDescription.length).toBeGreaterThan(10);
  });
});
