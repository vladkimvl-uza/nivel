import { EventEmitter } from "node:events";
import type { Db } from "@nivel/db";
import { describe, expect, it } from "vitest";
import { guardPool } from "./pool.ts";
import { recordingLogger } from "./test-support/fakes.ts";

describe("guardPool: an idle client of the pool that loses its connection does not stop the worker", () => {
  it("without a listener the pool would throw on 'error'; with the guard it logs and goes on", () => {
    const pool = new EventEmitter();
    const db = { $client: pool } as unknown as Db;
    expect(() => pool.emit("error", new Error("terminating connection"))).toThrow();
    const { log, lines } = recordingLogger();
    guardPool(db, log);
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("error");
    expect(JSON.stringify(lines[0])).toContain("terminating connection");
  });

  it("does not put a phone number or a token of the error into the log", () => {
    const pool = new EventEmitter();
    const { log, lines } = recordingLogger();
    guardPool({ $client: pool } as unknown as Db, log);
    pool.emit("error", new Error("failed for +998 90 123-45-67"));
    expect(JSON.stringify(lines)).not.toContain("123-45-67");
  });
});
