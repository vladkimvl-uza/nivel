import { describe, expect, it, vi } from "vitest";

// next-intl hands the function to the framework; here it is called directly, the way the framework calls it per request.
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));

const config = async (requestLocale: unknown) => {
  const { default: fn } = (await import("./request.ts")) as unknown as {
    default: (o: {
      requestLocale: Promise<unknown>;
    }) => Promise<{ locale: string; messages: Record<string, unknown>; timeZone: string }>;
  };
  return fn({ requestLocale: Promise.resolve(requestLocale) });
};

describe("request config", () => {
  it("uses the language of the address and loads its messages", async () => {
    const ru = await config("ru");
    expect(ru.locale).toBe("ru");
    expect(JSON.stringify(ru.messages.site)).toContain("Рабочее место под вашу задачу");
    expect(ru.timeZone).toBe("Asia/Tashkent");
  });

  it("falls back to Uzbek for an unknown or missing language", async () => {
    expect((await config("de")).locale).toBe("uz");
    expect((await config(undefined)).locale).toBe("uz");
  });
});
