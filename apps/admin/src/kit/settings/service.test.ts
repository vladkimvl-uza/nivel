import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type Role } from "../../auth/roles.ts";
import type { SessionUser } from "../../auth/service.ts";
import {
  createHttpRevalidator,
  createSettingsService,
  type Revalidator,
  type SettingsStore,
  tashkentDate,
} from "./service.ts";

const baseFee = {
  version: "2026-10-05",
  effectiveFrom: "2026-10-05",
  pcLowRateBp: 1500,
  pcHighRateBp: 1000,
  pcThreshold: 20_000_000,
  pcHighMinFee: 3_000_000,
  mountRateBp: 1500,
  complexRateBp: 1500,
  minFullCyclePc: 6_700_000,
  minFreeWindowPc: 4_500_000,
  minFullCycleSetup: 13_300_000,
  stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
  commissionLineStages: ["selection", "purchase"],
  advanceBp: 3000,
  reserveBp: 300,
  reserveHighBp: 500,
  reserveHighShareBp: 2500,
  reserveRoundStep: 10_000,
  podborShareBp: 2000,
  podborCreditDays: 30,
  afterTestsRetainBp: 8500,
  shelfLifeHours: { components: 24, furniture: 72 },
};
const { version: _v, ...feeInput } = baseFee;

class MemorySettings implements SettingsStore {
  readonly data = new Map<string, { value: unknown; version: number }>();
  readonly writes: { key: string; by: string }[] = [];
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: unknown, by: string, opts: { expectedVersion?: number } = {}) {
    const cur = this.data.get(key);
    if (opts.expectedVersion !== undefined && (cur?.version ?? 0) !== opts.expectedVersion) {
      throw new Error("stale_status: settings changed meanwhile");
    }
    const version = (cur?.version ?? 0) + 1;
    this.data.set(key, { value, version });
    this.writes.push({ key, by });
    return { version };
  }
  async setMany(changes: { key: string; value: unknown }[], by: string) {
    for (const c of changes) await this.set(c.key, c.value, by);
  }
}

const user = (role: Role): SessionUser => ({
  id: "u1",
  email: "u@nivel.uz",
  role,
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
});

// 06.10.2026 12:00 in Tashkent is 07:00 UTC.
const NOW = new Date("2026-10-06T07:00:00Z");

function setup() {
  const store = new MemorySettings();
  store.data.set("money.fee_settings", { value: baseFee, version: 1 });
  store.data.set("money.threshold", {
    value: {
      annualLimit: 1_000_000_000,
      planCap: 200_000_000,
      alertsBp: [6000, 8000, 10000],
      proportion: "without_registration_day",
    },
    version: 1,
  });
  store.data.set("calendar.work", {
    value: { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] },
    version: 1,
  });
  for (const f of ["feature.ai", "feature.setupConfigurator", "feature.scene", "feature.miniApp"])
    store.data.set(f, { value: false, version: 1 });
  const calls: string[][] = [];
  const outbox: string[][] = [];
  const revalidator = {
    ok: true,
    revalidate: async (tags: string[]) => (
      calls.push(tags), revalidator.ok ? { ok: true as const } : { ok: false as const, error: "web down" }
    ),
  };
  const service = createSettingsService({
    store,
    revalidator: revalidator as Revalidator,
    outbox: { enqueueRevalidate: async (tags) => void outbox.push(tags) },
    now: () => NOW,
  });
  return { store, service, calls, outbox, revalidator };
}

describe("who sees what", () => {
  it("the assistant sees no money settings and no flags, only the calendar", async () => {
    const { service } = setup();
    await expect(service.loadFee(user("assistant"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.loadThreshold(user("assistant"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.loadFlags(user("assistant"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.loadCalendar(user("assistant"))).resolves.toMatchObject({ value: { from: "10:00" } });
    expect(service.sections(user("assistant"))).toEqual(["calendar"]);
    expect(service.sections(user("owner"))).toEqual(["money", "threshold", "calendar", "flags"]);
    expect(service.sections(user("translator"))).toEqual([]);
  });

  it("the accountant reads money, and writes nothing", async () => {
    const { service, store } = setup();
    await expect(service.loadFee(user("accountant"))).resolves.toMatchObject({ value: { version: "2026-10-05" } });
    await expect(service.saveFee(user("accountant"), feeInput, { expectedVersion: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.saveCalendar(user("assistant"), {}, { expectedVersion: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(store.writes).toEqual([]);
  });
});

describe("fee settings with a version and an effective date", () => {
  it("a change that takes effect today replaces the live settings and gets a new version name", async () => {
    const { service, store, calls } = setup();
    const r = await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    expect(r).toMatchObject({ ok: true, scheduled: false, revalidated: true });
    const live = store.data.get("money.fee_settings");
    expect(live?.version).toBe(2);
    expect(live?.value).toMatchObject({ version: "2026-10-06", effectiveFrom: "2026-10-06", pcLowRateBp: 1400 });
    expect(store.writes).toEqual([{ key: "money.fee_settings", by: "admin:u1" }]);
    expect(calls).toEqual([["settings", "fee"]]);
  });

  it("a change for a later date waits as a scheduled one; the live settings stay in force until that day", async () => {
    const { service, store } = setup();
    const r = await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-11-01", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    expect(r).toMatchObject({ ok: true, scheduled: true });
    expect((store.data.get("money.fee_settings")?.value as { pcLowRateBp: number }).pcLowRateBp).toBe(1500);
    expect(store.data.get("money.fee_settings.next")?.value).toMatchObject({
      version: "2026-11-01",
      pcLowRateBp: 1400,
    });
    const loaded = await service.loadFee(user("owner"));
    expect(loaded.next?.value).toMatchObject({ effectiveFrom: "2026-11-01" });
  });

  it("refuses a date in the past, a change that changes nothing, and an immediate change over a scheduled one", async () => {
    const { service, store } = setup();
    expect(
      await service.saveFee(
        user("owner"),
        { ...feeInput, effectiveFrom: "2026-10-05", pcLowRateBp: 1400 },
        { expectedVersion: 1 },
      ),
    ).toEqual({
      ok: false,
      errors: { effectiveFrom: "Дата вступления не может быть в прошлом." },
    });
    expect(
      await service.saveFee(user("owner"), { ...feeInput, effectiveFrom: "2026-10-06" }, { expectedVersion: 1 }),
    ).toEqual({
      ok: false,
      errors: { "": "Ничего не изменилось." },
    });
    await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-11-01", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    const blocked = await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1300 },
      { expectedVersion: 1 },
    );
    expect(blocked).toMatchObject({ ok: false, errors: { "": expect.stringContaining("01.11.2026") } });
    expect(store.data.get("money.fee_settings")?.version).toBe(1);
  });

  it("returns the errors of invalid input by field, in Russian, and writes nothing", async () => {
    const { service, store } = setup();
    const r = await service.saveFee(
      user("owner"),
      {
        ...feeInput,
        effectiveFrom: "2026-11-01",
        pcLowRateBp: 15.5,
        stageSharesBp: { selection: 1, purchase: 2, assembly: 3, handover: 4 },
      },
      { expectedVersion: 1 },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.pcLowRateBp).toBe("Нужно целое число.");
    expect(r.errors.stageSharesBp).toBe("Доли этапов должны давать ровно 10 000 б. п. (100 %).");
    expect(store.writes).toEqual([]);
  });

  it("a second window with an old version number loses: nobody overwrites a newer change", async () => {
    const { service } = setup();
    await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    const stale = await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1300 },
      { expectedVersion: 1 },
    );
    expect(stale).toEqual({
      ok: false,
      errors: { "": "Настройки уже изменили в другом окне. Откройте страницу заново." },
    });
  });

  it("the second change for the same day gets the next name", async () => {
    const { service, store } = setup();
    await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1300 },
      { expectedVersion: 2 },
    );
    expect((store.data.get("money.fee_settings")?.value as { version: string }).version).toBe("2026-10-06.2");
  });

  it("a scheduled change can be cancelled, and comes into force when its day arrives", async () => {
    const { service, store } = setup();
    await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-11-01", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    expect(await service.cancelScheduledFee(user("owner"))).toEqual({ ok: true });
    expect((await service.loadFee(user("owner"))).next).toBeNull();

    await service.saveFee(
      user("owner"),
      { ...feeInput, effectiveFrom: "2026-11-01", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    // not yet
    expect(await service.promoteDue()).toBe(0);
    const later = createSettingsService({
      store,
      revalidator: { revalidate: async () => ({ ok: true }) },
      now: () => new Date("2026-11-01T00:30:00+05:00"),
    });
    expect(await later.promoteDue()).toBe(1);
    expect(store.data.get("money.fee_settings")?.value).toMatchObject({ version: "2026-11-01", pcLowRateBp: 1400 });
    expect((await later.loadFee(user("owner"))).next).toBeNull();
    expect(await later.promoteDue()).toBe(0);
  });
});

describe("calendar, response hours, threshold and flags", () => {
  const calendar = {
    tz: "Asia/Tashkent",
    workdays: [1, 2, 3, 4, 5, 6],
    from: "09:00",
    to: "20:00",
    holidays: ["2026-12-31"],
  };

  it("saves the calendar and the response hours for any date: they apply at once", async () => {
    const { service, store, calls } = setup();
    expect(await service.saveCalendar(user("owner"), calendar, { expectedVersion: 1 })).toMatchObject({
      ok: true,
      revalidated: true,
    });
    expect(store.data.get("calendar.work")?.value).toEqual(calendar);
    expect(calls).toEqual([["settings"]]);
  });

  it("refuses an end before the start", async () => {
    const { service } = setup();
    const r = await service.saveCalendar(
      user("owner"),
      { ...calendar, from: "20:00", to: "09:00" },
      { expectedVersion: 1 },
    );
    expect(r).toEqual({ ok: false, errors: { to: "Начало часов ответа должно быть раньше конца." } });
  });

  it("saves the threshold settings", async () => {
    const { service, store } = setup();
    const next = {
      annualLimit: 1_000_000_000,
      planCap: 150_000_000,
      alertsBp: [5000, 9000],
      proportion: "with_registration_day",
      registrationDate: "2026-11-02",
    };
    expect(await service.saveThreshold(user("owner"), next, { expectedVersion: 1 })).toMatchObject({ ok: true });
    expect(store.data.get("money.threshold")?.value).toEqual(next);
  });

  it("saves the four flags, each with its own version, and only the changed ones", async () => {
    const { service, store, calls } = setup();
    const r = await service.saveFlags(user("owner"), {
      "feature.ai": true,
      "feature.scene": false,
      "feature.miniApp": false,
      "feature.setupConfigurator": true,
    });
    expect(r).toMatchObject({ ok: true, changed: ["feature.ai", "feature.setupConfigurator"] });
    expect(store.data.get("feature.ai")?.value).toBe(true);
    expect(store.data.get("feature.scene")?.version).toBe(1);
    expect(calls).toEqual([["settings"]]);
    expect(await service.saveFlags(user("owner"), { "feature.ai": true })).toMatchObject({ ok: true, changed: [] });
  });

  it("ignores a flag that does not exist and refuses one that is not a yes/no", async () => {
    const { service, store } = setup();
    expect(await service.saveFlags(user("owner"), { "feature.bogus": true } as never)).toMatchObject({
      ok: true,
      changed: [],
    });
    expect(store.data.has("feature.bogus")).toBe(false);
    expect(await service.saveFlags(user("owner"), { "feature.ai": "yes" } as never)).toMatchObject({ ok: false });
  });

  it("reads the flags, with a missing flag counted as off", async () => {
    const { service, store } = setup();
    store.data.delete("feature.scene");
    expect(await service.loadFlags(user("owner"))).toEqual({
      "feature.ai": { value: false, version: 1 },
      "feature.setupConfigurator": { value: false, version: 1 },
      "feature.scene": { value: false, version: 0 },
      "feature.miniApp": { value: false, version: 1 },
    });
  });
});

describe("site cache: the tag settings is reissued", () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
  });

  it("every successful save asks the site to drop the tag settings", async () => {
    await h.service.saveCalendar(
      user("owner"),
      { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5], from: "10:00", to: "19:00", holidays: [] },
      { expectedVersion: 1 },
    );
    expect(h.calls.flat()).toContain("settings");
  });

  it("when the site does not answer, the settings are still saved and a retry is queued", async () => {
    h.revalidator.ok = false;
    const r = await h.service.saveCalendar(
      user("owner"),
      { tz: "Asia/Tashkent", workdays: [1, 2, 3], from: "10:00", to: "19:00", holidays: [] },
      { expectedVersion: 1 },
    );
    expect(r).toMatchObject({ ok: true, revalidated: false });
    expect(h.outbox).toEqual([["settings"]]);
  });

  it("nothing is asked when the save is refused", async () => {
    await h.service.saveCalendar(
      user("owner"),
      { tz: "Asia/Tashkent", workdays: [], from: "10:00", to: "19:00", holidays: [] },
      { expectedVersion: 1 },
    );
    expect(h.calls).toEqual([]);
  });
});

describe("http revalidator", () => {
  const key = "k".repeat(40);

  it("signs the call with HMAC-SHA256 over timestamp and body", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const revalidator = createHttpRevalidator({
      baseUrl: "http://127.0.0.1:3400/",
      key,
      now: () => new Date("2026-10-06T07:00:00Z"),
      fetch: async (url, init) => (
        seen.push({ url: String(url), init: init ?? {} }), new Response("{}", { status: 200 })
      ),
    });
    expect(await revalidator.revalidate(["settings", "fee"])).toEqual({ ok: true });
    const call = seen[0];
    expect(call?.url).toBe("http://127.0.0.1:3400/api/internal/revalidate");
    expect(call?.init.method).toBe("POST");
    const body = String(call?.init.body);
    expect(JSON.parse(body)).toEqual({ tags: ["settings", "fee"] });
    const headers = new Headers(call?.init.headers);
    const timestamp = headers.get("x-nivel-timestamp");
    expect(timestamp).toBe(String(Date.parse("2026-10-06T07:00:00Z")));
    expect(headers.get("x-nivel-signature")).toBe(
      createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex"),
    );
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("reports an answer other than 2xx and a network failure, never throws", async () => {
    const down = createHttpRevalidator({
      baseUrl: "http://x",
      key,
      fetch: async () => new Response("no", { status: 503 }),
    });
    expect(await down.revalidate(["settings"])).toEqual({ ok: false, error: "HTTP 503" });
    const broken = createHttpRevalidator({
      baseUrl: "http://x",
      key,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await broken.revalidate(["settings"])).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("gives up after a few seconds instead of hanging the screen", async () => {
    const slow = createHttpRevalidator({
      baseUrl: "http://x",
      key,
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(await slow.revalidate(["settings"])).toEqual({ ok: false, error: "aborted" });
  });
});

describe("tashkentDate", () => {
  it("is the date in UTC+5: the evening of one day in UTC is already the next day in Tashkent", () => {
    expect(tashkentDate(new Date("2026-10-06T18:59:59Z"))).toBe("2026-10-06");
    expect(tashkentDate(new Date("2026-10-06T19:00:00Z"))).toBe("2026-10-07");
    expect(tashkentDate(new Date("2026-12-31T19:30:00Z"))).toBe("2027-01-01");
  });
});
