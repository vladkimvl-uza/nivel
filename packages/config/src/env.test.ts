import { describe, expect, it } from "vitest";
import { appPort, EnvError, loadEnv } from "./env.ts";

const key = "k".repeat(44);

describe("loadEnv", () => {
  it("accepts a bot without token and defaults to polling", () => {
    const env = loadEnv("bot", {
      DATABASE_URL_BOT: "postgres://nivel_bot:x@127.0.0.1:54329/nivel",
      PUBLIC_BASE_URL: "http://localhost:3100",
      BOT_TOKEN: "",
    });
    expect(env.BOT_TOKEN).toBeUndefined();
    expect(env.BOT_MODE).toBe("polling");
    expect(env.TELEGRAM_OWNER_IDS).toEqual([]);
    expect(env.APP_MODE).toBe("development");
  });

  it("requires a webhook secret in webhook mode", () => {
    expect(() =>
      loadEnv("bot", {
        DATABASE_URL_BOT: "postgres://a:b@127.0.0.1:54329/nivel",
        PUBLIC_BASE_URL: "http://localhost:3100",
        BOT_MODE: "webhook",
      }),
    ).toThrow(EnvError);
  });

  it("lists every missing variable", () => {
    try {
      loadEnv("admin", {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const text = (e as EnvError).message;
      for (const name of ["DATABASE_URL_ADMIN", "ADMIN_BASE_URL", "DATA_ENC_KEY", "REVALIDATE_HMAC_KEY"]) {
        expect(text).toContain(name);
      }
    }
  });

  it("parses AI flag and slot", () => {
    const env = loadEnv("web", {
      DATABASE_URL_WEB: "postgres://a:b@127.0.0.1:54329/nivel",
      PUBLIC_BASE_URL: "http://localhost:3200",
      REVALIDATE_HMAC_KEY: key,
      AI_ENABLED: "false",
      NIVEL_SLOT: "1",
    });
    expect(env.AI_ENABLED).toBe(false);
    expect(env.NIVEL_SLOT).toBe(1);
  });

  it("requires DATA_ENC_KEY to be exactly 32 bytes of base64", () => {
    const admin = (DATA_ENC_KEY: string) =>
      loadEnv("admin", {
        DATABASE_URL_ADMIN: "postgres://a:b@127.0.0.1:54329/nivel",
        PUBLIC_BASE_URL: "http://localhost:3100",
        ADMIN_BASE_URL: "http://localhost:3101",
        REVALIDATE_HMAC_KEY: key,
        DATA_ENC_KEY,
      });
    expect(admin(Buffer.alloc(32, 7).toString("base64")).DATA_ENC_KEY).toHaveLength(44);
    expect(() => admin(key)).toThrow(EnvError); // 44 chars, but decodes to 33 bytes
    expect(() => admin(Buffer.alloc(24, 7).toString("base64"))).toThrow(EnvError);
    expect(() => admin(`${"k".repeat(43)}!`)).toThrow(EnvError);
  });
});

describe("appPort", () => {
  it("follows 3100 + 100 × slot", () => {
    expect(appPort("web", 0)).toBe(3100);
    expect(appPort("bot", 0)).toBe(3103);
    expect(appPort("admin", 1)).toBe(3201);
  });
});
