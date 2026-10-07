import { ops } from "@nivel/db/repos";
import { DEFAULT_FEE_SETTINGS } from "@nivel/domain/fee";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFailureSink } from "../../queues/failures.ts";
import { testRuntime } from "../../queues/test-support/runtime.ts";
import { createWorld, theRow, type World } from "../../queues/test-support/world.ts";
import { relayDepsOf } from "../outbox/register.ts";
import { relayOnce } from "../outbox/relay.ts";
import { handleErrorDigest } from "./digest.ts";
import { FEE_KEY, FEE_NEXT_KEY, NOTHING_SCHEDULED, promoteDueFeeScale } from "./promote.ts";
import { digestDepsOf, promoteDepsOf, selfcheckDepsOf } from "./register.ts";
import { runSelfcheck } from "./selfcheck.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
  await ops.setSetting(w.db, "telegram.owner_group", { chatId: -1001234567890 }, "test");
});
afterAll(async () => {
  await w.close();
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<T>(sql, params).then((r) => r.rows);

describe("ops.selfcheck on the real database, as the role worker", () => {
  it("writes an alert when the copy is old, and the relay sends it to the owner's group in Russian", async () => {
    const t = testRuntime(w, {
      probes: { backupAgeHours: async () => 30.5, diskUsedPercent: async () => 40, certDaysLeft: async () => 90 },
    });
    const results = await runSelfcheck(selfcheckDepsOf(t.rt));
    expect(results.find((r) => r.check === "backup_age")).toMatchObject({ state: "alert", detail: "30 ч" });
    const rows = await q<{ dedupe_key: string; priority: number; payload: { target: string; templateKey: string } }>(
      "select dedupe_key, priority, payload from ops.outbox where dedupe_key like 'ops:alert:%'",
    );
    expect(rows).toHaveLength(1);
    expect(theRow(rows).payload).toMatchObject({ target: "group", templateKey: "ops.alert" });
    expect(theRow(rows).priority).toBe(8);

    await relayOnce(relayDepsOf(t.rt), { limit: 50 });
    const text = t.telegram.sent.map((m) => m.text).find((m) => m.includes("копия"));
    expect(text).toBe("Резервная копия устарела: 30 ч");
  });

  it("does not repeat the alert within six hours: the second run finds the first", async () => {
    const t = testRuntime(w, {
      probes: { backupAgeHours: async () => 31, diskUsedPercent: async () => 40, certDaysLeft: async () => 90 },
    });
    await runSelfcheck(selfcheckDepsOf(t.rt));
    await runSelfcheck(selfcheckDepsOf(t.rt));
    expect(await q("select 1 from ops.outbox where dedupe_key like 'ops:alert:backup_age:%'")).toHaveLength(1);
  });

  it("sees an outbox that does not go out: a row that has been due for more than ten minutes", async () => {
    await ops.enqueueOutbox(w.workerDb, {
      kind: "job",
      dedupeKey: "stuck-1",
      payload: { job: "threshold.check" },
      sendAfter: new Date(Date.now() - 15 * 60_000),
    });
    const t = testRuntime(w, {
      probes: { backupAgeHours: async () => 1, diskUsedPercent: async () => 40, certDaysLeft: async () => 90 },
    });
    const results = await runSelfcheck(selfcheckDepsOf(t.rt));
    expect(results.find((r) => r.check === "outbox_stalled")).toMatchObject({ state: "alert" });
  });

  it("sees a queue of pg-boss that stands", async () => {
    const t = testRuntime(w, {
      probes: { backupAgeHours: async () => 1, diskUsedPercent: async () => 40, certDaysLeft: async () => 90 },
    });
    t.jobs.stalledQueues.push({ queue: "ledger.append", seconds: 1500 });
    const results = await runSelfcheck(selfcheckDepsOf(t.rt));
    expect(results.find((r) => r.check === "queue_stalled")).toMatchObject({
      state: "alert",
      detail: "ledger.append: 25 мин",
    });
  });

  it("looks at the webhook in the webhook mode only", async () => {
    const polling = testRuntime(w);
    expect(selfcheckDepsOf(polling.rt).webhook).toBeNull();
    const hook = testRuntime(w, { settings: { botMode: "webhook" } });
    expect(selfcheckDepsOf(hook.rt).webhook).not.toBeNull();
  });
});

describe("ops.error_digest on the real database", () => {
  it("sums up the failures of the day in one message to the group", async () => {
    const { rt } = testRuntime(w, { realClock: true });
    const sink = createFailureSink({ db: w.workerDb, now: () => new Date() });
    await sink.recordFinal({ queue: "ledger.append", attempts: 5, error: new Error("db down") });
    await sink.recordFinal({ queue: "ledger.append", attempts: 5, error: new Error("db down") });
    await sink.recordFinal({ queue: "web.revalidate", attempts: 7, error: new Error("HTTP 502") });
    const result = await handleErrorDigest(digestDepsOf(rt));
    expect(result).toEqual({ sent: true, items: 2 });
    const [row] = await q<{ payload: { params: { items: { queue: string; count: number }[] } } }>(
      "select payload from ops.outbox where dedupe_key like 'ops:digest:%'",
    );
    expect(row?.payload.params.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queue: "ledger.append", count: 2 }),
        expect.objectContaining({ queue: "web.revalidate", count: 1 }),
      ]),
    );
  });
});

describe("the scheduled scale of the fee", () => {
  const scale = (effectiveFrom: string) => ({
    ...structuredClone(DEFAULT_FEE_SETTINGS),
    version: effectiveFrom,
    effectiveFrom,
    pcLowRateBp: 1400,
  });
  const today = () => "2026-10-12"; // the fake clock of the world: Monday 12 October 2026, 10:00 in Tashkent

  it("is left in its slot by the role worker: it has SELECT on ops.settings and no right to write it (DATA-MAP 2)", async () => {
    await ops.setSetting(w.db, FEE_NEXT_KEY, scale(today()), "owner");
    const t = testRuntime(w);
    expect(await promoteDueFeeScale(promoteDepsOf(t.rt))).toEqual({ outcome: "no_right", effectiveFrom: today() });
    expect((await ops.getSetting(w.db, FEE_NEXT_KEY))?.value).toEqual(scale(today()));
    expect(t.lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("is put into force on its day by a role that may write the settings, in one step with the clearing of the slot", async () => {
    // The same code with the handle of the admin role (which holds the right): this is what the grant of the integrator would do.
    const t = testRuntime(w);
    const adminDb = promoteDepsOf({ ...t.rt, db: w.db });
    expect(await promoteDueFeeScale(adminDb)).toEqual({ outcome: "promoted", effectiveFrom: today() });
    expect((await ops.getSetting(w.db, FEE_KEY))?.value).toEqual(scale(today()));
    expect((await ops.getSetting(w.db, FEE_NEXT_KEY))?.value).toEqual(NOTHING_SCHEDULED);
    const audit = await q<{ actor: string; entity_id: string }>(
      "select actor, entity_id from ops.audit_log where action = 'setting.set' and actor = 'system:settings' order by at",
    );
    expect(audit.map((a) => a.entity_id).sort()).toEqual([FEE_KEY, FEE_NEXT_KEY].sort());
    expect(
      await q("select 1 from ops.outbox where dedupe_key = $1", [`web.revalidate:fee-promoted:${today()}`]),
    ).toHaveLength(1);
    // and again: the slot is empty now
    expect(await promoteDueFeeScale(adminDb)).toEqual({ outcome: "none" });
  });

  it("waits for a scale whose day has not come", async () => {
    await ops.setSetting(w.db, FEE_NEXT_KEY, scale("2026-11-01"), "owner");
    const t = testRuntime(w);
    expect(await promoteDueFeeScale(promoteDepsOf({ ...t.rt, db: w.db }))).toEqual({
      outcome: "not_due",
      effectiveFrom: "2026-11-01",
    });
    expect((await ops.getSetting(w.db, FEE_NEXT_KEY))?.value).toEqual(scale("2026-11-01"));
  });
});
