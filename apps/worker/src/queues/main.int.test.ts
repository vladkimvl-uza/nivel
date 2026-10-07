// main.ts as a process: the worker started the way `pnpm start` starts it, against the throwaway database of this test, without
// BOT_TOKEN. It must come up on the database that the migration made (no CREATE on the database), register the twelve domains,
// answer /healthz, and its relay must skip a message of the outbox with the reason written on the row.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { ops } from "@nivel/db/repos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./test-support/world.ts";

let w: World;
let child: ChildProcess | undefined;
let port = 0;
let output = "";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const health = (): Promise<{ status: number; body: Record<string, unknown> } | null> =>
  new Promise((resolve) => {
    const req = get({ host: "127.0.0.1", port, path: "/healthz", timeout: 2000 }, (res) => {
      let text = "";
      res.on("data", (c) => {
        text += c;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });

async function until<T>(read: () => Promise<T | undefined | false | null>, ms = 40_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out; the output of the worker:\n${output.slice(-3000)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  w = await createWorld();
  port = await freePort();
  const main = fileURLToPath(new URL("../main.ts", import.meta.url));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    APP_MODE: "development",
    NIVEL_SLOT: process.env.NIVEL_SLOT ?? "0",
    PORT: String(port),
    DATABASE_URL_WORKER: process.env.DATABASE_URL_WORKER as string,
    PUBLIC_BASE_URL: "http://127.0.0.1:9",
    REVALIDATE_HMAC_KEY: "smoke-test-key-0123456789-0123456789-0123456789", // gitleaks:allow fake key of the smoke test
  };
  child = spawn(process.execPath, [main], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (c) => {
    output += c;
  });
  child.stderr?.on("data", (c) => {
    output += c;
  });
}, 60_000);

afterAll(async () => {
  // Only the process this test started, by its own handle.
  child?.kill();
  await w.close();
});

describe("the worker as a process", () => {
  it("starts on the database of the migration with no BOT_TOKEN, registers the twelve domains and answers /healthz", async () => {
    const answer = await until(async () => {
      const h = await health();
      return h?.status === 200 ? h : undefined;
    });
    expect(answer.body).toMatchObject({
      app: "worker",
      status: "ok",
      queue: "started",
      domains: 12,
      telegram: "disabled: no BOT_TOKEN",
      db: { ok: true },
    });
    expect(output).toContain("disabled: no BOT_TOKEN");
    expect(output).not.toContain("pg-boss error");
  }, 60_000);

  it("skips a message of the outbox it cannot send, with the reason on the row, and never calls Telegram", async () => {
    await ops.setSetting(w.db, "telegram.owner_group", { chatId: -1001234567890 }, "test");
    await ops.enqueueOutbox(w.workerDb, {
      kind: "telegram_message",
      dedupeKey: "smoke-1",
      payload: { target: "group", templateKey: "ops.alert", params: { check: "disk", detail: "85 %" } },
    });
    const row = await until(async () => {
      const { rows } = await w.db.$client.query<{ status: string; last_error: string | null }>(
        "select status, last_error from ops.outbox where dedupe_key = 'smoke-1'",
      );
      return rows[0]?.status === "failed" ? rows[0] : undefined;
    });
    expect(row.last_error).toBe("skipped: no BOT_TOKEN");
  }, 60_000);
});
