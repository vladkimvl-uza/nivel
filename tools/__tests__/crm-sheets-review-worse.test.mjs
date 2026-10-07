// Review round 2: a tile is "worse" (orange) only when the change matters. A small drop, a noise of three orders, a rate
// that is the same to a tenth of a percent: none of them is a deviation from the norm.
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
let p;

const pay = (id, sum, iso) =>
  p.call("nvAppendRow", "payments", {
    id,
    order: "NV-2026-0001",
    kind: "Финал платы 70 %",
    method: "QR Xolis",
    amount: sum,
    status: "Подтверждён",
    receipt: "FS-1",
    date: p.date(iso),
    confirmedAt: p.date(iso),
  });
const kpi = (key) => JSON.parse(p.run(`JSON.stringify(nvDashboardModel({}).kpis.${key})`));

describe("the fee tile", () => {
  beforeAll(() => {
    p = createProject({ now: T0 });
    p.call("nvSetup");
    p.call("nvAppendRow", "orders", {
      num: "NV-2026-0001",
      created: T0,
      status: "Сдан",
      code: "handed_over",
      kind: "ПК",
    });
    pay("P-2026-0001", 10_000_000, "2026-09-02T12:00:00+05:00");
  }, 60_000);

  it("a drop of 10 % is not worse; a drop of 30 % is", () => {
    pay("P-2026-0002", 9_000_000, "2026-10-02T12:00:00+05:00");
    expect(kpi("fee").worse).toBe(false);
    // a drop of 30 %
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    q.call("nvAppendRow", "orders", {
      num: "NV-2026-0001",
      created: T0,
      status: "Сдан",
      code: "handed_over",
      kind: "ПК",
    });
    const add = (id, kind, sum, iso, method = "QR Xolis") =>
      q.call("nvAppendRow", "payments", {
        id,
        order: "NV-2026-0001",
        kind,
        method,
        amount: sum,
        status: "Подтверждён",
        receipt: "FS-1",
        date: q.date(iso),
        confirmedAt: q.date(iso),
      });
    add("P-2026-0001", "Финал платы 70 %", 10_000_000, "2026-09-02T12:00:00+05:00");
    add("P-2026-0002", "Финал платы 70 %", 7_000_000, "2026-10-02T12:00:00+05:00");
    const m = JSON.parse(q.run("JSON.stringify(nvDashboardModel({}).kpis.fee)"));
    expect(m.worse).toBe(true);
  });

  it("the sheet says the same: the flag is a change of NV_WORSE_PCT or more", () => {
    const defs = JSON.parse(p.run("JSON.stringify(nvKpiDefs())"));
    expect(defs.fee.worse).toContain("NV_WORSE_PCT");
    expect(defs.fee.worse).toContain("*(1-NV_WORSE_PCT/100)");
    expect(defs.reply.worse).toContain("*(1+NV_WORSE_PCT/100)");
    expect(p.call("nvSettings").worsePct).toBe(20);
  });

  it("a count of the previous period below three is too small to alarm: delivered and leads have the floor", () => {
    const defs = JSON.parse(p.run("JSON.stringify(nvKpiDefs())"));
    expect(defs.delivered.worse).toContain(">=3");
    expect(defs.leads.worse).toContain(">=3");
    expect(defs.fee.worse).not.toContain(">=3");
  });
});

describe("the counts", () => {
  it("2 delivered against 1 in the previous period is not worse (too few); 2 against 10 is", () => {
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    const add = (n, iso) =>
      q.call("nvAppendRow", "orders", {
        num: `NV-2026-${String(n).padStart(4, "0")}`,
        created: q.date(iso),
        status: "Сдан",
        code: "handed_over",
        kind: "ПК",
        dHandover: q.date(iso),
        dAccepted: q.date(iso),
      });
    add(1, "2026-09-03T12:00:00+05:00");
    add(2, "2026-10-03T12:00:00+05:00");
    let m = JSON.parse(q.run("JSON.stringify(nvDashboardModel({}).kpis.delivered)"));
    expect(m.worse).toBe(false);
    for (let i = 3; i <= 12; i++) add(i, "2026-09-04T12:00:00+05:00");
    m = JSON.parse(q.run("JSON.stringify(nvDashboardModel({}).kpis.delivered)"));
    expect(m.prev).toBe(11);
    expect(m.worse).toBe(true);
  });
});
