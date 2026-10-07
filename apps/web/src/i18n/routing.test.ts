import { describe, expect, it } from "vitest";
import { routing } from "./routing.ts";

describe("routing", () => {
  it("has Uzbek first, the prefix always, and no alternate links in headers", () => {
    expect(routing.locales).toEqual(["uz", "ru"]);
    expect(routing.defaultLocale).toBe("uz");
    expect(routing.localePrefix).toBe("always");
    expect(routing.alternateLinks).toBe(false);
  });
});
