import { ops } from "@nivel/db/repos";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_IDS_KEY,
  assistantIds,
  CALENDAR_KEY,
  OWNER_GROUP_KEY,
  ownerGroupId,
  paymentRequisites,
  REQUISITES_KEY,
  staffRole,
  warnAboutSettings,
  workCalendar,
} from "./config.ts";
import { type BotWorld, createBotWorld } from "./testing/world.ts";

let w: BotWorld;
beforeAll(async () => {
  w = await createBotWorld({ withGroup: false });
});
afterAll(async () => {
  await w.close();
});

const set = (key: string, value: unknown) => ops.setSetting(w.db, key, value, "test");
const db = () => w.bot.db;

describe("the id of the owner's group", () => {
  it("is null until the owner has set it", async () => {
    expect(await ownerGroupId(db())).toBeNull();
  });

  it("is the negative number of a supergroup, as a number or as { chatId }", async () => {
    await set(OWNER_GROUP_KEY, -1_001_234_567_890);
    expect(await ownerGroupId(db())).toBe(-1_001_234_567_890);
    await set(OWNER_GROUP_KEY, { chatId: -1_009_876 });
    expect(await ownerGroupId(db())).toBe(-1_009_876);
  });

  it("is null for anything that is not the id of a group: zero, a positive number, a text, a fraction", async () => {
    for (const bad of [0, 12345, "minus one thousand", -1.5, { chatId: "x" }, [], true]) {
      await set(OWNER_GROUP_KEY, bad);
      expect(await ownerGroupId(db()), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("the assistants and the roles", () => {
  it("none until set; only digit strings count", async () => {
    expect(await assistantIds(db())).toEqual([]);
    await set(ASSISTANT_IDS_KEY, ["6001000002", 42, "abc", "12 3", "7"]);
    expect(await assistantIds(db())).toEqual(["6001000002", "7"]);
    await set(ASSISTANT_IDS_KEY, "6001000002");
    expect(await assistantIds(db())).toEqual([]);
  });

  it("the owner is an id of TELEGRAM_OWNER_IDS, the assistant an id of the settings, anybody else nobody", async () => {
    await set(ASSISTANT_IDS_KEY, ["6001000002"]);
    const deps = { db: db(), ownerIds: ["6001000001"] };
    expect(await staffRole(deps, 6_001_000_001)).toBe("owner");
    expect(await staffRole(deps, 6_001_000_002)).toBe("assistant");
    expect(await staffRole(deps, 6_999_000_009)).toBeNull();
    // An id that is both in the owners and in the assistants is the owner (the stronger role is the database's to confirm).
    expect(await staffRole({ db: db(), ownerIds: ["6001000002"] }, 6_001_000_002)).toBe("owner");
  });
});

describe("the hours of the answers", () => {
  const at = (iso: string) => new Date(iso);

  it("are Monday to Saturday 10:00-19:00 in Tashkent until the owner sets his calendar", async () => {
    const cal = await workCalendar(db());
    expect(cal.isResponseHours(at("2026-10-12T10:00:00+05:00"))).toBe(true);
    expect(cal.isResponseHours(at("2026-10-12T19:00:00+05:00"))).toBe(false);
    expect(cal.isResponseHours(at("2026-10-11T12:00:00+05:00"))).toBe(false); // Sunday
  });

  it("follow the holidays and the hours of the owner", async () => {
    await set(CALENDAR_KEY, { holidays: ["2026-10-13", "bad", 5], from: "09:00", to: "18:00" });
    const cal = await workCalendar(db());
    expect(cal.isResponseHours(at("2026-10-12T09:30:00+05:00"))).toBe(true);
    expect(cal.isResponseHours(at("2026-10-12T18:30:00+05:00"))).toBe(false);
    expect(cal.isResponseHours(at("2026-10-13T12:00:00+05:00"))).toBe(false);
  });

  it("a broken calendar does not stop the bot: the default hours are used", async () => {
    await set(CALENDAR_KEY, { holidays: [], from: "25:99", to: "07:00" });
    const cal = await workCalendar(db());
    expect(cal.isResponseHours(at("2026-10-12T10:00:00+05:00"))).toBe(true);
    await set(CALENDAR_KEY, "nonsense");
    expect((await workCalendar(db())).isResponseHours(at("2026-10-12T10:00:00+05:00"))).toBe(true);
  });
});

describe("the requisites of the account of the sole proprietor", () => {
  it("are null until the owner enters them, or when there is nothing to show", async () => {
    expect(await paymentRequisites(db())).toBeNull();
    await set(REQUISITES_KEY, { purpose: "only a purpose" });
    expect(await paymentRequisites(db())).toBeNull();
    await set(REQUISITES_KEY, "text");
    expect(await paymentRequisites(db())).toBeNull();
    await set(REQUISITES_KEY, []);
    expect(await paymentRequisites(db())).toBeNull();
  });

  it("are the holder, the bank, the account, the MFO and the INN in one line, with the purpose of the payment", async () => {
    await set(REQUISITES_KEY, {
      holder: "YaTT Nivel",
      bank: "Bank",
      account: "2020 8000",
      mfo: " ",
      inn: "123",
      purpose: "Xarid",
    });
    expect(await paymentRequisites(db())).toEqual({ text: "YaTT Nivel, Bank, 2020 8000, 123", purpose: "Xarid" });
    await set(REQUISITES_KEY, { holder: "YaTT Nivel" });
    expect(await paymentRequisites(db())).toEqual({ text: "YaTT Nivel" });
  });
});

describe("what the owner has not set yet is said in the log at the start", () => {
  const logger = () => ({ warn: vi.fn() });

  it("names the group and the requisites that are missing", async () => {
    await set(OWNER_GROUP_KEY, 0);
    await set(REQUISITES_KEY, {});
    const log = logger();
    await warnAboutSettings(db(), log);
    const said = log.warn.mock.calls.map((c) => c[1]);
    expect(said.some((m) => String(m).includes(OWNER_GROUP_KEY))).toBe(true);
    expect(said.some((m) => String(m).includes(REQUISITES_KEY))).toBe(true);
  });

  it("is silent when both are set", async () => {
    await set(OWNER_GROUP_KEY, -1_001_234_567_890);
    await set(REQUISITES_KEY, { holder: "YaTT Nivel", account: "20208000900100000001" });
    const log = logger();
    await warnAboutSettings(db(), log);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("does not fail the start when the settings cannot be read", async () => {
    const log = logger();
    await expect(warnAboutSettings({} as never, log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
