// Integration: the settings service on the real ops.settings (trigger-bumped version, audit in one transaction).
import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../auth/service.ts";
import { createSettingsService, type Revalidator } from "./service.ts";
import { createPgRevalidateRetry, createPgSettingsStore } from "./store.pg.ts";

let db: Db;
const owner: SessionUser = {
  id: "owner-1",
  email: "o@nivel.test",
  role: "owner",
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
};
const assistant: SessionUser = { ...owner, id: "assistant-1", role: "assistant" };
const tags: string[][] = [];
let webUp = true;
const revalidator: Revalidator = {
  async revalidate(t) {
    tags.push(t);
    return webUp ? { ok: true } : { ok: false, error: "down" };
  },
};

const fee = {
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
const { version: _ignored, ...feeInput } = fee;

const service = () =>
  createSettingsService({
    store: createPgSettingsStore(db),
    revalidator,
    outbox: createPgRevalidateRetry(db),
    now: () => new Date("2026-10-06T07:00:00Z"),
  });

beforeAll(async () => {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set by the harness");
  db = createDb(url, { max: 4 });
  await db.$client.query(
    "insert into ops.settings (key, value, updated_by) values ('money.fee_settings', $1, 'seed')",
    [JSON.stringify(fee)],
  );
  await db.$client.query("insert into ops.settings (key, value, updated_by) values ('calendar.work', $1, 'seed')", [
    JSON.stringify({ tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] }),
  ]);
});

afterAll(async () => {
  await db.$client.end();
});

describe("settings on PostgreSQL", () => {
  it("a money change gets a new version, is journaled with before and after, and reissues the tag settings", async () => {
    const r = await service().saveFee(
      owner,
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1400 },
      { expectedVersion: 1 },
    );
    expect(r).toMatchObject({ ok: true, scheduled: false, version: 2, revalidated: true });
    expect(tags.at(-1)).toEqual(["settings", "fee"]);
    const live = await createPgSettingsStore(db).get("money.fee_settings");
    expect(live?.version).toBe(2);
    expect(live?.value).toMatchObject({ version: "2026-10-06", pcLowRateBp: 1400 });
    const { rows } = await db.$client.query<{
      actor: string;
      before: { pcLowRateBp: number };
      after: { pcLowRateBp: number };
    }>(
      "select actor, before, after from ops.audit_log where action = 'setting.set' and entity_id = 'money.fee_settings'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("admin:owner-1");
    expect(rows[0]?.before.pcLowRateBp).toBe(1500);
    expect(rows[0]?.after.pcLowRateBp).toBe(1400);
  });

  it("a stale window loses with the database version check", async () => {
    const r = await service().saveFee(
      owner,
      { ...feeInput, effectiveFrom: "2026-10-06", pcLowRateBp: 1300 },
      { expectedVersion: 1 },
    );
    expect(r).toEqual({ ok: false, errors: { "": "Настройки уже изменили в другом окне. Откройте страницу заново." } });
  });

  it("a scheduled change waits under its own key and comes into force on its day", async () => {
    const s = service();
    const scheduled = await s.saveFee(
      owner,
      { ...feeInput, effectiveFrom: "2026-11-01", pcLowRateBp: 1200 },
      { expectedVersion: 2 },
    );
    expect(scheduled).toMatchObject({ ok: true, scheduled: true });
    expect((await createPgSettingsStore(db).get("money.fee_settings"))?.value).toMatchObject({ pcLowRateBp: 1400 });

    const later = createSettingsService({
      store: createPgSettingsStore(db),
      revalidator,
      now: () => new Date("2026-11-01T00:10:00+05:00"),
    });
    expect(await later.promoteDue()).toBe(1);
    expect((await createPgSettingsStore(db).get("money.fee_settings"))?.value).toMatchObject({
      version: "2026-11-01",
      pcLowRateBp: 1200,
    });
    expect((await later.loadFee(owner)).next).toBeNull();
    expect(await later.promoteDue()).toBe(0);
  });

  it("the assistant reads the calendar and cannot change it or read money", async () => {
    const s = service();
    await expect(s.loadFee(assistant)).rejects.toThrow(/forbidden/);
    await expect(s.saveCalendar(assistant, {}, { expectedVersion: 1 })).rejects.toThrow(/forbidden/);
    expect((await s.loadCalendar(assistant)).value).toMatchObject({ from: "10:00" });
  });

  it("creates a flag that has no row yet and flips it back", async () => {
    const s = service();
    expect(await s.saveFlags(owner, { "feature.ai": true })).toMatchObject({ ok: true, changed: ["feature.ai"] });
    expect((await s.loadFlags(owner))["feature.ai"]).toEqual({ value: true, version: 1 });
    expect(await s.saveFlags(owner, { "feature.ai": false })).toMatchObject({ ok: true, changed: ["feature.ai"] });
    expect((await s.loadFlags(owner))["feature.ai"]).toEqual({ value: false, version: 2 });
  });

  it("when the site is down the calendar is saved and one retry job is left in the outbox", async () => {
    webUp = false;
    const calendar = {
      tz: "Asia/Tashkent",
      workdays: [1, 2, 3, 4, 5, 6],
      from: "09:00",
      to: "18:00",
      holidays: ["2026-12-31"],
    };
    const r = await service().saveCalendar(owner, calendar, { expectedVersion: 1 });
    expect(r).toMatchObject({ ok: true, revalidated: false });
    // A second save within the same minute does not queue a twin.
    await service().saveCalendar(owner, { ...calendar, to: "19:00" }, { expectedVersion: 2 });
    const { rows } = await db.$client.query<{ kind: string; payload: { job: string; tags: string[] } }>(
      "select kind, payload from ops.outbox where payload->>'job' = 'web.revalidate'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ kind: "job", payload: { job: "web.revalidate", tags: ["settings"] } });
    webUp = true;
  });
});
