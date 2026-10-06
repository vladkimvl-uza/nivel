// The server actions of the settings screens, called as the forms call them: with the cookie of a session and a FormData.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tashkentDate } from "./service.ts";

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../auth/runtime.ts", () => ({ getRuntime: () => app.current }));
vi.mock("next/headers", async () => (await import("../test-support/fake-app.ts")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createFakeApp, form } = await import("../test-support/fake-app.ts");
const actions = await import("./actions.ts");

let fake: Awaited<ReturnType<typeof createFakeApp>>;
beforeEach(() => {
  fake = createFakeApp();
  app.current = fake.runtime;
});

const empty = { errors: {}, values: {} };
const today = () => tashkentDate(new Date());

const feeForm = (over: Record<string, string> = {}) =>
  form({
    expectedVersion: "1",
    effectiveFrom: today(),
    pcLowRateBp: "1400",
    pcHighRateBp: "1000",
    pcThreshold: "20000000",
    pcHighMinFee: "3000000",
    mountRateBp: "1500",
    complexRateBp: "1500",
    minFullCyclePc: "6700000",
    minFreeWindowPc: "4500000",
    minFullCycleSetup: "13300000",
    "stageSharesBp.selection": "2000",
    "stageSharesBp.purchase": "3000",
    "stageSharesBp.assembly": "3500",
    "stageSharesBp.handover": "1500",
    "commissionLineStages.__present": "1",
    commissionLineStages: ["selection", "purchase"],
    advanceBp: "3000",
    reserveBp: "300",
    reserveHighBp: "500",
    reserveHighShareBp: "2500",
    reserveRoundStep: "10000",
    podborShareBp: "2000",
    podborCreditDays: "30",
    afterTestsRetainBp: "8500",
    "shelfLifeHours.components": "24",
    "shelfLifeHours.furniture": "72",
    ...over,
  });

describe("who may call the actions", () => {
  it("a person who is not signed in changes nothing and the attempt is journaled as anonymous", async () => {
    const state = await actions.saveFeeAction(empty, feeForm());
    expect(state).toMatchObject({ ok: false, message: "Недостаточно прав для этого действия." });
    expect(fake.settingsStore.data.get("money.fee_settings")?.version).toBe(1);
    expect(fake.audit.at(-1)).toMatchObject({
      actor: "anonymous",
      action: "settings.save_fee.denied",
      after: { role: null, needed: "settings.money.write" },
    });
    expect(fake.revalidations).toEqual([]);
  });

  it("the assistant may not change money, the threshold, the calendar or the flags; every attempt is journaled", async () => {
    const { user } = await fake.signInAs("assistant");
    expect(await actions.saveFeeAction(empty, feeForm())).toMatchObject({
      ok: false,
      message: "Недостаточно прав для этого действия.",
    });
    expect(await actions.saveThresholdAction(empty, form({ expectedVersion: "1", annualLimit: "5" }))).toMatchObject({
      ok: false,
    });
    expect(
      await actions.saveCalendarAction(
        empty,
        form({ expectedVersion: "1", from: "08:00", to: "20:00", workdays: "1" }),
      ),
    ).toMatchObject({ ok: false });
    expect(await actions.saveFlagsAction(empty, form({ ai: "true" }))).toMatchObject({ ok: false });
    await actions.cancelScheduledFeeAction();
    const denied = fake.audit.filter((a) => a.action.endsWith(".denied"));
    expect(denied.map((a) => a.action)).toEqual([
      "settings.save_fee.denied",
      "settings.save_threshold.denied",
      "settings.save_calendar.denied",
      "settings.save_flags.denied",
      "settings.cancel_fee.denied",
    ]);
    expect(denied.every((a) => a.actor === `admin:${user.id}`)).toBe(true);
    expect(fake.settingsStore.data.get("money.fee_settings")?.version).toBe(1);
    expect(fake.settingsStore.data.get("calendar.work")?.version).toBe(1);
    expect(fake.revalidations).toEqual([]);
  });
});

describe("the owner", () => {
  beforeEach(async () => {
    await fake.signInAs("owner");
  });

  it("saves the fee scale for today: new version, the site is told, the message says from which date", async () => {
    const state = await actions.saveFeeAction(empty, feeForm());
    expect(state.ok).toBe(true);
    expect(state.message).toContain("новая версия шкалы действует с");
    expect(fake.settingsStore.data.get("money.fee_settings")?.version).toBe(2);
    expect(fake.revalidations).toEqual([["settings", "fee"]]);
  });

  it("saves a later date as scheduled, and cancels it", async () => {
    const later = new Date(Date.now() + 5 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10);
    const state = await actions.saveFeeAction(empty, feeForm({ effectiveFrom: later }));
    expect(state.message).toContain("Сохранено как запланированное");
    expect(fake.settingsStore.data.get("money.fee_settings")?.version).toBe(1);
    await actions.cancelScheduledFeeAction();
    expect(fake.settingsStore.data.get("money.fee_settings.next")?.value).toEqual({ cleared: true });
  });

  it("returns what could not be read or checked, by field, with the typed values", async () => {
    const unreadable = await actions.saveFeeAction(empty, feeForm({ pcLowRateBp: "четырнадцать сотен" }));
    expect(unreadable).toMatchObject({ ok: false, errors: { pcLowRateBp: "Нужно число." } });
    const past = await actions.saveFeeAction(empty, feeForm({ effectiveFrom: "2020-01-01" }));
    expect(past.errors.effectiveFrom).toBe("Дата вступления не может быть в прошлом.");
    const stale = await actions.saveFeeAction(empty, feeForm({ expectedVersion: "7" }));
    expect(stale.errors[""]).toContain("в другом окне");
    expect(fake.settingsStore.data.get("money.fee_settings")?.version).toBe(1);
  });

  it("saves the threshold, and refuses alerts that do not rise", async () => {
    const good = await actions.saveThresholdAction(
      empty,
      form({
        expectedVersion: "1",
        annualLimit: "900000000",
        planCap: "",
        alertsBp: "5000\n9000",
        proportion: "with_registration_day",
        registrationDate: "2026-11-02",
      }),
    );
    expect(good).toMatchObject({ ok: true, message: "Сохранено." });
    const bad = await actions.saveThresholdAction(
      empty,
      form({
        expectedVersion: "2",
        annualLimit: "900000000",
        alertsBp: "9000\n5000",
        proportion: "with_registration_day",
      }),
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.alertsBp).toContain("по возрастанию");
    const unreadable = await actions.saveThresholdAction(
      empty,
      form({ expectedVersion: "2", annualLimit: "много", alertsBp: "1", proportion: "with_registration_day" }),
    );
    expect(unreadable.errors.annualLimit).toBe("Нужно число.");
  });

  it("saves the calendar, but not while a holiday is not a date", async () => {
    const good = await actions.saveCalendarAction(
      empty,
      form({
        expectedVersion: "1",
        "workdays.__present": "1",
        workdays: ["1", "2", "3"],
        from: "09:00",
        to: "18:00",
        holidays: "31.12.2026",
      }),
    );
    expect(good).toMatchObject({ ok: true });
    expect(fake.settingsStore.data.get("calendar.work")?.value).toMatchObject({ holidays: ["2026-12-31"] });
    const bad = await actions.saveCalendarAction(
      empty,
      form({ expectedVersion: "2", workdays: ["1"], from: "08:00", to: "18:00", holidays: "завтра" }),
    );
    expect(bad).toMatchObject({ ok: false, errors: { holidays: "Не дата: завтра." } });
    expect(fake.settingsStore.data.get("calendar.work")?.version).toBe(2);
    const stale = await actions.saveCalendarAction(
      empty,
      form({ expectedVersion: "1", workdays: ["1"], from: "08:00", to: "18:00", holidays: "" }),
    );
    expect(stale.errors[""]).toContain("в другом окне");
  });

  it("switches flags, says when nothing changed", async () => {
    expect(
      await actions.saveFlagsAction(
        empty,
        form({ ai: "true", setupConfigurator: "false", scene: "false", miniApp: "false" }),
      ),
    ).toMatchObject({
      ok: true,
      message: "Сохранено.",
    });
    expect(fake.settingsStore.data.get("feature.ai")?.value).toBe(true);
    expect(await actions.saveFlagsAction(empty, form({ ai: "true" }))).toMatchObject({
      ok: true,
      message: "Ничего не изменилось.",
    });
  });
});
