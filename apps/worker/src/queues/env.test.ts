import { describe, expect, it } from "vitest";
import { readExtraEnv } from "./env.ts";

describe("readExtraEnv: the variables the schema of the worker does not list yet (request to the integrator)", () => {
  it("has the defaults when nothing is set: polling, no CRM, no mark file", () => {
    expect(readExtraEnv({})).toEqual({
      botMode: "polling",
      sheetsUrl: undefined,
      sheetsSecret: undefined,
      backupMarkFile: undefined,
    });
  });

  it("treats empty and blank values as not set, as the schema of the other apps does", () => {
    expect(
      readExtraEnv({ BOT_MODE: "", NIVEL_SHEETS_URL: "  ", NIVEL_SHEETS_SECRET: "", BACKUP_MARK_FILE: "" }),
    ).toEqual({
      botMode: "polling",
      sheetsUrl: undefined,
      sheetsSecret: undefined,
      backupMarkFile: undefined,
    });
  });

  it("reads webhook, the CRM pair and the mark file", () => {
    expect(
      readExtraEnv({
        BOT_MODE: "webhook",
        NIVEL_SHEETS_URL: " https://script.google.com/macros/s/X/exec ",
        NIVEL_SHEETS_SECRET: "s",
        BACKUP_MARK_FILE: "/backup/last_ok",
      }),
    ).toEqual({
      botMode: "webhook",
      sheetsUrl: "https://script.google.com/macros/s/X/exec",
      sheetsSecret: "s",
      backupMarkFile: "/backup/last_ok",
    });
  });

  it("refuses a BOT_MODE that is neither polling nor webhook instead of falling back to polling in silence", () => {
    for (const bad of ["Webhook", "WEBHOOK", "web-hook", "long-polling"]) {
      expect(() => readExtraEnv({ BOT_MODE: bad })).toThrow(/BOT_MODE must be polling or webhook/);
    }
  });
});
