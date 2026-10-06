import { createDb } from "@nivel/db";
import { DEFAULT_FEE_SETTINGS } from "@nivel/domain/fee";
import { afterEach, describe, expect, it } from "vitest";
import { dsl } from "./dsl.ts";
import { ConfigError, ForbiddenError, NotFoundError, ServiceError, ValidationError } from "./errors.ts";
import { canonicalJson, eventDigest, eventIdentity } from "./keys.ts";
import {
  can,
  configureServices,
  createRuntime,
  readAppMode,
  requireCapability,
  resetServices,
  runtimeOf,
} from "./runtime.ts";
import { parseCalendarSettings, parseFeeSettings, parseThresholdSettings } from "./settings.ts";

const lazyDb = () => createDb("postgres://u:p@127.0.0.1:1/never_connected_test");

describe("errors", () => {
  it("carry a machine code and a readable message", () => {
    const v = ValidationError.of("lines.0.qty", "qty_too_large", "Quantity must not exceed 99");
    expect(v).toBeInstanceOf(ServiceError);
    expect(v.code).toBe("validation_failed");
    expect(v.message).toBe("lines.0.qty: Quantity must not exceed 99");
    expect(v.issues).toEqual([{ path: "lines.0.qty", code: "qty_too_large", message: "Quantity must not exceed 99" }]);
    expect(v.name).toBe("ValidationError");
  });

  it("omit the path of a whole-input problem", () => {
    expect(new ValidationError([{ path: "", code: "empty", message: "Nothing to quote" }]).message).toBe(
      "Nothing to quote",
    );
  });

  it("have distinct codes", () => {
    expect(new NotFoundError("order").code).toBe("not_found");
    expect(new NotFoundError("order").message).toBe("order not found");
    expect(new ForbiddenError("no").code).toBe("forbidden");
    expect(new ConfigError("broken").code).toBe("config_invalid");
  });
});

describe("runtime", () => {
  afterEach(() => resetServices());

  it("refuses to run before it is configured", () => {
    expect(() => runtimeOf()).toThrow(ConfigError);
  });

  it("uses the configured runtime and lets a caller bring its own", () => {
    const db = lazyDb();
    const own = createRuntime({ db, role: "bot", appMode: "development" });
    const configured = configureServices({ db, role: "admin", appMode: "staging" });
    expect(runtimeOf()).toBe(configured);
    expect(runtimeOf(own)).toBe(own);
    void db.$client.end();
  });

  it("reads the clock of the process and refuses an invalid date", () => {
    const db = lazyDb();
    const fixed = new Date("2026-10-12T09:00:00Z");
    expect(createRuntime({ db, role: "admin", appMode: "development", now: () => fixed }).now()).toEqual(fixed);
    expect(() => createRuntime({ db, role: "admin", appMode: "development", now: () => new Date("x") }).now()).toThrow(
      ConfigError,
    );
    void db.$client.end();
  });

  it("reads APP_MODE like packages/config", () => {
    expect(readAppMode(undefined)).toBe("development");
    expect(readAppMode("  ")).toBe("development");
    expect(readAppMode("production")).toBe("production");
    expect(() => readAppMode("Production")).toThrow(ConfigError);
    expect(() => readAppMode("prod")).toThrow(ConfigError);
  });

  it("grants writes by the role of the database", () => {
    const db = lazyDb();
    const rt = (role: "web" | "admin" | "bot" | "worker") => createRuntime({ db, role, appMode: "development" });
    expect(can(rt("admin"), "payments.write")).toBe(true);
    expect(can(rt("bot"), "payments.write")).toBe(false);
    expect(can(rt("web"), "orders.read")).toBe(false);
    expect(can(rt("worker"), "ledger.write")).toBe(true);
    // The bot and the worker expect payments through the function of the database, the site queues a job.
    expect(["admin", "bot", "worker", "web"].map((role) => can(rt(role as "web"), "payments.expect"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    // Only the bot signs an act by the button through the database function; the admin panel writes acts itself.
    expect(["admin", "bot", "worker", "web"].map((role) => can(rt(role as "web"), "acts.sign_button"))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(["admin", "bot", "worker", "web"].map((role) => can(rt(role as "web"), "leads.bind"))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(can(rt("web"), "consents.money")).toBe(false);
    expect(() => requireCapability(rt("web"), "quotes.write")).toThrow(ForbiddenError);
    expect(() => requireCapability(rt("admin"), "quotes.write")).not.toThrow();
    void db.$client.end();
  });
});

describe("dsl", () => {
  it("hands over the operators of drizzle once, without a connection", () => {
    const db = lazyDb();
    const first = dsl(db);
    expect(typeof first.sql).toBe("function");
    expect(typeof first.eq).toBe("function");
    expect(dsl(db)).toBe(first);
    void db.$client.end();
  });
});

describe("canonicalJson and the identity of an event", () => {
  it("sorts keys at every level and writes dates as ISO text", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: new Date("2026-10-12T00:00:00Z") } })).toBe(
      '{"a":{"c":"2026-10-12T00:00:00.000Z","d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("drops undefined values like JSON does", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("gives the same digest for the same event whatever the key order", () => {
    expect(eventDigest({ type: "FEE_PREPAID", paymentId: "p1" })).toBe(
      eventDigest({ paymentId: "p1", type: "FEE_PREPAID" }),
    );
    expect(eventDigest({ type: "FEE_PREPAID", paymentId: "p1" })).not.toBe(
      eventDigest({ type: "FEE_PREPAID", paymentId: "p2" }),
    );
    expect(eventDigest({ type: "CLOSE" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores the amounts of a cancellation: the server computes them", () => {
    const a = { type: "CANCEL", point: "before_accept", reason: "x", settlement: { feeEarned: 1 } };
    const b = { type: "CANCEL", point: "before_accept", reason: "x", settlement: { feeEarned: 999 } };
    expect(eventDigest(eventIdentity(a))).toBe(eventDigest(eventIdentity(b)));
    expect(eventDigest(eventIdentity({ ...a, reason: "y" }))).not.toBe(eventDigest(eventIdentity(a)));
  });

  it("keeps the owner input of a cancellation in its identity", () => {
    const a = { type: "CANCEL", point: "during_assembly", reason: "x", assemblyDoneBp: 2000 };
    expect(eventDigest(eventIdentity(a))).not.toBe(eventDigest(eventIdentity({ ...a, assemblyDoneBp: 3000 })));
  });

  it("leaves other events as they are", () => {
    const e = { type: "OBJECTION", text: "the price" };
    expect(eventIdentity(e)).toEqual(e);
  });
});

describe("settings", () => {
  it("parses the default fee settings back to themselves", () => {
    expect(parseFeeSettings(JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS)))).toEqual(DEFAULT_FEE_SETTINGS);
  });

  it("names the field that is missing or not a whole number", () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS));
    delete raw.pcLowRateBp;
    expect(() => parseFeeSettings(raw)).toThrow(/pcLowRateBp/);
    expect(() => parseFeeSettings({ ...JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS)), pcThreshold: 20.5 })).toThrow(
      /pcThreshold/,
    );
    expect(() => parseFeeSettings(null)).toThrow(ConfigError);
    expect(() => parseFeeSettings("x")).toThrow(ConfigError);
  });

  it("refuses shares of stages that do not add up to 10 000 bp and rates above 100 %", () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS));
    raw.stageSharesBp.assembly = 3000;
    expect(() => parseFeeSettings(raw)).toThrow(/stageSharesBp/);
    const rate = JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS));
    rate.advanceBp = 10_001;
    expect(() => parseFeeSettings(rate)).toThrow(/advanceBp/);
  });

  it("refuses unknown stage names and a bad date", () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS));
    raw.commissionLineStages = ["selection", "magic"];
    expect(() => parseFeeSettings(raw)).toThrow(/commissionLineStages/);
    const date = JSON.parse(JSON.stringify(DEFAULT_FEE_SETTINGS));
    date.effectiveFrom = "05.10.2026";
    expect(() => parseFeeSettings(date)).toThrow(/effectiveFrom/);
  });

  it("parses the calendar of the owner and refuses a broken one", () => {
    const cal = parseCalendarSettings({ holidays: ["2026-10-13"], from: "10:00", to: "19:00" });
    expect(cal.isWorkingDay("2026-10-13")).toBe(false);
    expect(cal.isWorkingDay("2026-10-14")).toBe(true);
    expect(
      parseCalendarSettings({ tz: "Asia/Tashkent", workdays: [1, 2], from: "09:00", to: "18:00", holidays: [] }),
    ).toBeTruthy();
    expect(() => parseCalendarSettings({ holidays: ["13.10.2026"], from: "10:00", to: "19:00" })).toThrow(ConfigError);
    expect(() => parseCalendarSettings({ holidays: [], from: "19:00", to: "10:00" })).toThrow(ConfigError);
    expect(() => parseCalendarSettings(undefined)).toThrow(ConfigError);
  });

  it("parses the threshold settings with an optional registration date", () => {
    const s = parseThresholdSettings({
      annualLimit: 1_000_000_000,
      planCap: 200_000_000,
      alertsBp: [6000, 10000],
      proportion: "without_registration_day",
      registrationDate: "2026-10-15",
    });
    expect(s.annualLimit).toBe(1_000_000_000);
    expect(s.registrationDate).toBe("2026-10-15");
    expect(() =>
      parseThresholdSettings({ annualLimit: 1.5, alertsBp: [], proportion: "without_registration_day" }),
    ).toThrow(/annualLimit/);
    expect(() => parseThresholdSettings({ annualLimit: 1, alertsBp: [], proportion: "sometimes" })).toThrow(
      /proportion/,
    );
  });
});
