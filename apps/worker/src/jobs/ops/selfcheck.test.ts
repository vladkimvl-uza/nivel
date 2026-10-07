import type { ops } from "@nivel/db/repos";
import { describe, expect, it } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import { runSelfcheck, SELFCHECK_LIMITS, type SelfcheckDeps } from "./selfcheck.ts";

function setup(
  over: {
    backup?: number | null;
    disk?: number | null;
    cert?: number | null;
    stalled?: { queue: string; seconds: number }[];
    outbox?: number | null;
    webhook?: { lastErrorDate: number | null; lastErrorMessage: string | null } | "off" | Error;
    now?: Date;
    strict?: boolean;
  } = {},
) {
  const clock = new FakeClock(over.now ?? new Date("2026-10-12T10:00:00+05:00"));
  const enqueued: ops.OutboxInput[] = [];
  const { log, lines } = recordingLogger();
  const deps: SelfcheckDeps = {
    now: clock.now,
    log,
    strict: over.strict ?? false,
    probes: {
      backupAgeHours: async () => (over.backup === undefined ? 3 : over.backup),
      diskUsedPercent: async () => (over.disk === undefined ? 40 : over.disk),
      certDaysLeft: async () => (over.cert === undefined ? 60 : over.cert),
    },
    stalledQueues: async () => over.stalled ?? [],
    outboxStalledSeconds: async () => (over.outbox === undefined ? null : over.outbox),
    webhook:
      over.webhook === "off" || over.webhook === undefined
        ? null
        : async () => {
            if (over.webhook instanceof Error) throw over.webhook;
            return over.webhook as { lastErrorDate: number | null; lastErrorMessage: string | null };
          },
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
  };
  return { deps, clock, enqueued, lines };
}

const alertOf = (e: ops.OutboxInput) => e.payload.params as { check: string; detail: string };

describe("runSelfcheck: the limits of ARCHITECTURE 9", () => {
  it("has the limits of the architecture: a copy older than 26 hours, a disk over 80 %, a certificate under 14 days, a queue that stands 10 minutes", () => {
    expect(SELFCHECK_LIMITS).toEqual({
      backupMaxHours: 26,
      diskMaxPercent: 80,
      certMinDays: 14,
      stallSeconds: 600,
      webhookErrorWindowMs: 15 * 60_000,
    });
  });

  it("writes no alert when everything is in order", async () => {
    const t = setup();
    const results = await runSelfcheck(t.deps);
    expect(t.enqueued).toEqual([]);
    expect(results.find((r) => r.check === "backup_age")?.state).toBe("ok");
    expect(results.find((r) => r.check === "disk")?.state).toBe("ok");
  });

  it("writes an alert to the owner's group when the copy is older than 26 hours", async () => {
    const t = setup({ backup: 30.4 });
    const results = await runSelfcheck(t.deps);
    expect(t.enqueued).toHaveLength(1);
    expect(t.enqueued[0]).toMatchObject({
      kind: "telegram_message",
      priority: 8,
      payload: { target: "group", templateKey: "ops.alert", lang: "ru" },
    });
    expect(alertOf(t.enqueued[0] as ops.OutboxInput)).toEqual({ check: "backup_age", detail: "30 ч" });
    expect(results.find((r) => r.check === "backup_age")).toMatchObject({ state: "alert" });
  });

  it("does not raise an alarm at exactly 26 hours", async () => {
    const t = setup({ backup: 26 });
    await runSelfcheck(t.deps);
    expect(t.enqueued).toEqual([]);
  });

  it("alerts when no copy was ever made (the mark of the backup is not there)", async () => {
    const t = setup({ backup: Number.POSITIVE_INFINITY });
    await runSelfcheck(t.deps);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput)).toEqual({ check: "backup_age", detail: "копия не найдена" });
  });

  it("alerts when the disk is over 80 % and not at 80", async () => {
    const t = setup({ disk: 85.2 });
    await runSelfcheck(t.deps);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput)).toEqual({ check: "disk", detail: "85 %" });
    const at80 = setup({ disk: 80 });
    await runSelfcheck(at80.deps);
    expect(at80.enqueued).toEqual([]);
  });

  it("alerts when the certificate has under 14 days left", async () => {
    const t = setup({ cert: 9 });
    await runSelfcheck(t.deps);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput)).toEqual({ check: "certificate", detail: "9 дн." });
    const fine = setup({ cert: 14 });
    await runSelfcheck(fine.deps);
    expect(fine.enqueued).toEqual([]);
  });

  it("alerts for a certificate that has run out", async () => {
    const t = setup({ cert: -2 });
    await runSelfcheck(t.deps);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput).detail).toBe("-2 дн.");
  });

  it("alerts when a queue of pg-boss stands: a job ready for more than 10 minutes that nobody takes", async () => {
    const t = setup({ stalled: [{ queue: "ledger.append", seconds: 1260 }] });
    await runSelfcheck(t.deps);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput)).toEqual({
      check: "queue_stalled",
      detail: "ledger.append: 21 мин",
    });
  });

  it("alerts when the outbox does not go out: a due row waits more than 10 minutes", async () => {
    const t = setup({ outbox: 900 });
    await runSelfcheck(t.deps);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput)).toEqual({ check: "outbox_stalled", detail: "15 мин" });
    const quick = setup({ outbox: 300 });
    await runSelfcheck(quick.deps);
    expect(quick.enqueued).toEqual([]);
  });

  it("looks at the last error of the webhook in the webhook mode only, and only a recent one", async () => {
    const nowSec = Math.floor(new Date("2026-10-12T10:00:00+05:00").getTime() / 1000);
    const recent = setup({
      webhook: { lastErrorDate: nowSec - 120, lastErrorMessage: "Wrong response from the webhook: 502" },
    });
    await runSelfcheck(recent.deps);
    expect(alertOf(recent.enqueued[0] as ops.OutboxInput)).toEqual({
      check: "webhook",
      detail: "Wrong response from the webhook: 502",
    });
    const old = setup({ webhook: { lastErrorDate: nowSec - 3600, lastErrorMessage: "old" } });
    await runSelfcheck(old.deps);
    expect(old.enqueued).toEqual([]);
    const none = setup({ webhook: { lastErrorDate: null, lastErrorMessage: null } });
    await runSelfcheck(none.deps);
    expect(none.enqueued).toEqual([]);
    const polling = setup({ webhook: "off" });
    expect((await runSelfcheck(polling.deps)).find((r) => r.check === "webhook")).toBeUndefined();
  });

  it("says it cannot tell, and does not alarm, for what the runtime cannot look at", async () => {
    const t = setup({ backup: null, disk: null, cert: null });
    const results = await runSelfcheck(t.deps);
    expect(t.enqueued).toEqual([]);
    for (const check of ["backup_age", "disk", "certificate"]) {
      expect(results.find((r) => r.check === check)?.state).toBe("unknown");
    }
  });

  it("does not let one check that fails hide the others: it is reported as unknown, the rest run", async () => {
    const t = setup({ webhook: new Error("getWebhookInfo: timeout"), backup: 40 });
    const results = await runSelfcheck(t.deps);
    expect(results.find((r) => r.check === "webhook")).toMatchObject({ state: "unknown" });
    expect(t.enqueued.map((e) => alertOf(e).check)).toEqual(["backup_age"]);
    expect(t.lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("tells about each failing check once in six hours: the key holds the day and the block of six hours of Tashkent", async () => {
    const early = setup({ backup: 40, now: new Date("2026-10-12T05:59:00+05:00") });
    const late = setup({ backup: 40, now: new Date("2026-10-12T06:00:00+05:00") });
    const same = setup({ backup: 40, now: new Date("2026-10-12T11:59:00+05:00") });
    for (const t of [early, late, same]) await runSelfcheck(t.deps);
    expect(early.enqueued[0]?.dedupeKey).toBe("ops:alert:backup_age:2026-10-12:0");
    expect(late.enqueued[0]?.dedupeKey).toBe("ops:alert:backup_age:2026-10-12:1");
    expect(same.enqueued[0]?.dedupeKey).toBe("ops:alert:backup_age:2026-10-12:1");
  });

  it("writes one alert for each failing check", async () => {
    const t = setup({ backup: 40, disk: 90, cert: 3, outbox: 1200, stalled: [{ queue: "q", seconds: 700 }] });
    await runSelfcheck(t.deps);
    expect(t.enqueued.map((e) => alertOf(e).check).sort()).toEqual(
      ["backup_age", "certificate", "disk", "outbox_stalled", "queue_stalled"].sort(),
    );
  });

  it("in production a check that cannot be made is itself an alert, once a day: a forgotten BACKUP_MARK_FILE must not switch the copy check off for good", async () => {
    const t = setup({ strict: true, backup: null, disk: null, cert: null });
    const results = await runSelfcheck(t.deps);
    expect(results.filter((r) => r.state === "unknown").map((r) => r.check)).toEqual([
      "backup_age",
      "disk",
      "certificate",
    ]);
    expect(t.enqueued.map((e) => alertOf(e).check)).toEqual(["backup_age_blind", "disk_blind", "certificate_blind"]);
    expect(t.enqueued[0]).toMatchObject({
      kind: "telegram_message",
      payload: { target: "group", templateKey: "ops.alert" },
    });
    expect(t.enqueued.map((e) => e.dedupeKey)).toEqual([
      "ops:alert:backup_age_blind:2026-10-12",
      "ops:alert:disk_blind:2026-10-12",
      "ops:alert:certificate_blind:2026-10-12",
    ]);
    expect(alertOf(t.enqueued[0] as ops.OutboxInput).detail).toMatch(/BACKUP_MARK_FILE/);
  });

  it("outside production the same silence is only 'unknown': a development machine has no backup", async () => {
    const t = setup({ strict: false, backup: null, disk: null, cert: null });
    await runSelfcheck(t.deps);
    expect(t.enqueued).toEqual([]);
  });

  it("does not turn a check that failed with an error into a 'blind' alert: that is the other kind of trouble and is logged", async () => {
    const t = setup({ strict: true, webhook: new Error("getWebhookInfo: timeout") });
    await runSelfcheck(t.deps);
    expect(t.enqueued).toEqual([]);
  });
});
