import { describe, expect, it, vi } from "vitest";
import { readFeatureFlag, readFeeScale, resolveLegal, todayInTashkent } from "./data.ts";
import { DEFAULT_FEE_SCALE } from "./fee-scale.ts";
import type { LegalRow } from "./legal.ts";

const stored = {
  version: "2026-12-01",
  effectiveFrom: "2026-12-01",
  pcLowRateBp: 1400,
  pcHighRateBp: 900,
  pcThreshold: 21_000_000,
  pcHighMinFee: 3_150_000,
  mountRateBp: 1500,
  minFullCyclePc: 7_000_000,
  minFreeWindowPc: 4_500_000,
  minFullCycleSetup: 14_000_000,
  stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
  advanceBp: 3000,
  reserveBp: 300,
  reserveHighBp: 500,
  reserveHighShareBp: 2500,
  reserveRoundStep: 10_000,
  shelfLifeHours: { components: 24, furniture: 72 },
};

describe("readFeeScale", () => {
  it("takes the setting of the owner from the database", async () => {
    const r = await readFeeScale(async () => ({ value: stored }));
    expect(r.source).toBe("db");
    expect(r.scale.pcLowRateBp).toBe(1400);
    expect(r.scale.effectiveFrom).toBe("2026-12-01");
  });

  it("falls back to the defaults when the owner has set nothing", async () => {
    const r = await readFeeScale(async () => null);
    expect(r).toEqual({ scale: DEFAULT_FEE_SCALE, source: "default" });
  });

  it("falls back to the defaults, and says so, when the setting is broken", async () => {
    const log = vi.fn();
    const r = await readFeeScale(async () => ({ value: { ...stored, pcThreshold: "x" } }), log);
    expect(r.source).toBe("default");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("falls back to the defaults when the database does not answer, and logs no detail of the error", async () => {
    const log = vi.fn();
    const r = await readFeeScale(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:54329 as nivel_web password=secret");
    }, log);
    expect(r.source).toBe("default");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("54329");
  });
});

describe("readFeatureFlag", () => {
  it("is on only when the owner switched it on", async () => {
    expect(await readFeatureFlag(async () => ({ value: true }))).toBe(true);
  });

  it.each([false, "true", 1, null, {}, [], "on"])("is off for the stored value %j", async (value) => {
    expect(await readFeatureFlag(async () => ({ value }))).toBe(false);
  });

  it("is off when the setting does not exist (unfinished work is merged switched off)", async () => {
    expect(await readFeatureFlag(async () => null)).toBe(false);
  });

  it("is off, and says so without details, when the database does not answer", async () => {
    const log = vi.fn();
    const on = await readFeatureFlag(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:54329 password=secret");
    }, log);
    expect(on).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});

const row = (o: Partial<LegalRow> = {}): LegalRow => ({
  kind: "privacy",
  version: "3",
  lang: "ru",
  bodyMd: "# Политика",
  status: "published",
  textSha256: "b".repeat(64),
  id: "00000000-0000-4000-8000-000000000002",
  effectiveFrom: "2026-10-01",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...o,
});

describe("resolveLegal", () => {
  it("shows a published document of the database without the plaque of a draft", () => {
    expect(resolveLegal([row()], "privacy", "ru", "2026-10-07")).toEqual({
      source: "db",
      draft: false,
      version: "3",
      effectiveFrom: "2026-10-01",
      sha256: "b".repeat(64),
      bodyMd: "# Политика",
      id: "00000000-0000-4000-8000-000000000002",
    });
  });

  it("shows a stub of the database as a draft", () => {
    const r = resolveLegal([row({ status: "stub", effectiveFrom: null })], "privacy", "ru", "2026-10-07");
    expect(r).toMatchObject({ source: "db", draft: true, effectiveFrom: null });
  });

  it("shows a document approved by the lawyer but not published as a draft", () => {
    const r = resolveLegal([row({ status: "lawyer_approved", effectiveFrom: null })], "privacy", "ru", "2026-10-07");
    expect(r).toMatchObject({ source: "db", draft: true });
  });

  it("uses the text built into the site, as a draft, when the database has nothing", () => {
    expect(resolveLegal([], "privacy", "ru", "2026-10-07")).toEqual({ source: "builtin", draft: true });
    expect(resolveLegal([row({ lang: "uz" })], "privacy", "ru", "2026-10-07")).toEqual({
      source: "builtin",
      draft: true,
    });
  });
});

describe("todayInTashkent", () => {
  it("is the date in Asia/Tashkent (UTC+5), not in UTC", () => {
    expect(todayInTashkent(new Date("2026-10-06T20:30:00Z"))).toBe("2026-10-07");
    expect(todayInTashkent(new Date("2026-10-06T18:59:00Z"))).toBe("2026-10-06");
    expect(todayInTashkent(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
  });
});
