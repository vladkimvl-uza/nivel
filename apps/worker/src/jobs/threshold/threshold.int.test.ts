import { ops } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import { threshold } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purchasedOrder } from "../../queues/test-support/flow.ts";
import { testRuntime } from "../../queues/test-support/runtime.ts";
import { createWorld, theRow, type World } from "../../queues/test-support/world.ts";
import { handleThresholdCheck } from "./check.ts";
import { thresholdDepsOf } from "./register.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<T>(sql, params).then((r) => r.rows);

describe("threshold.check on the real database, as the role worker", () => {
  it("keeps the snapshot of the day and alerts the levels the share has crossed, once, and the forecast over the plan", async () => {
    // A small limit so that one order crosses some levels: the receipts of the PC are 11.85 million.
    await ops.setSetting(
      w.db,
      "money.threshold",
      {
        annualLimit: 20_000_000,
        planCap: 5_000_000,
        alertsBp: [6000, 7000, 8000, 9000, 10000],
        proportion: "without_registration_day",
      },
      "test",
    );
    await purchasedOrder(w);
    const year = Number(isoDateInTashkent(w.clock.now()).slice(0, 4));
    const expected = await threshold.status({ year }, w.worker);
    expect(expected.crossedAlerts.length).toBeGreaterThan(0);
    expect(expected.overPlanCap).toBe(true);

    const deps = thresholdDepsOf(testRuntime(w).rt);
    const first = await handleThresholdCheck(deps);
    expect(first.alerts).toEqual([...expected.crossedAlerts, "plan"]);

    const snapshots = await q<{
      year: number;
      as_of: string;
      deals_sum: string;
      limit_sum: string;
      plan_cap_sum: string;
      share_bp: number;
    }>(
      "select year, as_of::text, deals_sum::text, limit_sum::text, plan_cap_sum::text, share_bp from ops.threshold_snapshots",
    );
    expect(snapshots).toEqual([
      {
        year,
        as_of: isoDateInTashkent(w.clock.now()),
        deals_sum: String(expected.volume),
        limit_sum: "20000000",
        plan_cap_sum: "5000000",
        share_bp: expected.shareBp,
      },
    ]);

    const alerts = await q<{ dedupe_key: string; payload: { templateKey: string; target: string } }>(
      "select dedupe_key, payload from ops.outbox where dedupe_key like 'threshold:%' order by dedupe_key",
    );
    expect(alerts.map((a) => a.dedupe_key).sort()).toEqual(
      [...expected.crossedAlerts.map((l) => `threshold:${year}:${l}`), `threshold:${year}:plan`].sort(),
    );
    expect(new Set(alerts.map((a) => a.payload.target))).toEqual(new Set(["group"]));

    // the same day again (a payment came): one snapshot, no new alert
    await handleThresholdCheck(deps);
    expect(await q("select 1 from ops.threshold_snapshots")).toHaveLength(1);
    expect(await q("select 1 from ops.outbox where dedupe_key like 'threshold:%'")).toHaveLength(alerts.length);
  });

  it("rewrites the snapshot of the day when the numbers change", async () => {
    const deps = thresholdDepsOf(testRuntime(w).rt);
    await ops.setSetting(
      w.db,
      "money.threshold",
      { annualLimit: 40_000_000, planCap: 5_000_000, alertsBp: [6000], proportion: "without_registration_day" },
      "test",
    );
    await handleThresholdCheck(deps);
    const rows = await q<{ limit_sum: string }>("select limit_sum::text from ops.threshold_snapshots");
    expect(theRow(rows).limit_sum).toBe("40000000");
    expect(rows).toHaveLength(1);
  });
});
