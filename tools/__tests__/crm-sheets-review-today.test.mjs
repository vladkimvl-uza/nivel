// Review round 2: the sheet «Сегодня» and the hours of reply. Warnings are not overdue tasks; the term of the first reply and
// the column «Ответ, ч» count the working hours (10:00-19:00, Monday to Saturday, holidays); the list reads on a phone.
import { beforeAll, describe, expect, it } from "vitest";
import { createComputer } from "../crm-sheets/scripts/computed.mjs";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00"); // Wednesday
let p;
const read = (k) => p.call("nvReadTable", k);
const at = (iso) => p.date(iso);
const HOLIDAYS = ["2026-10-08"];

beforeAll(() => {
  p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
}, 60_000);

const addHours = (iso, h, holidays = []) =>
  p.call("nvAddWorkingHours", at(iso), h, holidays, "10:00", "19:00").toISOString();
const wh = (a, b, holidays = []) => p.call("nvWorkingHoursBetween", at(a), at(b), holidays, "10:00", "19:00");

describe("the working hours: the term of the first reply", () => {
  it("2 working hours from a lead that came at night are counted from the opening of the next window", () => {
    // Wednesday 23:00 -> Thursday 12:00 (Tashkent), not Thursday 01:00
    expect(addHours("2026-10-07T23:00:00+05:00", 2)).toBe(at("2026-10-08T12:00:00+05:00").toISOString());
  });
  it("before the opening of the same day: from 10:00", () => {
    expect(addHours("2026-10-07T08:00:00+05:00", 2)).toBe(at("2026-10-07T12:00:00+05:00").toISOString());
  });
  it("inside the window: from the moment", () => {
    expect(addHours("2026-10-07T13:30:00+05:00", 2)).toBe(at("2026-10-07T15:30:00+05:00").toISOString());
  });
  it("the end of the day carries the rest to the next working day", () => {
    expect(addHours("2026-10-07T18:00:00+05:00", 2)).toBe(at("2026-10-08T11:00:00+05:00").toISOString());
  });
  it("Saturday evening: the rest goes to Monday (Sunday is a day off)", () => {
    expect(addHours("2026-10-10T18:30:00+05:00", 2)).toBe(at("2026-10-12T11:30:00+05:00").toISOString());
    expect(addHours("2026-10-11T12:00:00+05:00", 2)).toBe(at("2026-10-12T12:00:00+05:00").toISOString());
  });
  it("a holiday is skipped", () => {
    expect(addHours("2026-10-07T18:00:00+05:00", 2, HOLIDAYS)).toBe(at("2026-10-09T11:00:00+05:00").toISOString());
  });
  it("the term is the inverse of the working hours between: hours(created, due) = 2", () => {
    for (const iso of [
      "2026-10-05T03:10:00+05:00",
      "2026-10-05T09:59:00+05:00",
      "2026-10-05T10:00:00+05:00",
      "2026-10-05T12:34:00+05:00",
      "2026-10-05T17:00:00+05:00",
      "2026-10-05T18:59:00+05:00",
      "2026-10-05T19:00:00+05:00",
      "2026-10-10T18:30:00+05:00",
      "2026-10-11T09:00:00+05:00",
      "2026-10-07T20:30:00+05:00",
    ]) {
      const due = addHours(iso, 2, HOLIDAYS);
      expect(wh(iso, due, HOLIDAYS), iso).toBeCloseTo(2, 6);
    }
  });
});

describe("the columns «Ответить до» and «Ответ, ч» of «Заявки» (formulas) follow the working hours", () => {
  const cases = [
    // created, first reply
    ["2026-10-05T23:00:00+05:00", "2026-10-06T10:30:00+05:00"], // night lead, answered at 10:30: 0.5 h, never negative
    ["2026-10-05T08:00:00+05:00", "2026-10-05T10:15:00+05:00"], // early lead: 0.3 h (10:00-10:15), not 2.25 h
    ["2026-10-05T11:00:00+05:00", "2026-10-05T12:45:00+05:00"],
    ["2026-10-05T18:00:00+05:00", "2026-10-06T11:00:00+05:00"],
    ["2026-10-10T18:30:00+05:00", "2026-10-12T10:30:00+05:00"], // over Sunday
    ["2026-10-07T18:00:00+05:00", "2026-10-09T11:00:00+05:00"], // over the holiday of 08.10
    ["2026-10-06T10:00:00+05:00", "2026-10-06T10:00:00+05:00"], // at once
    ["2026-10-06T20:00:00+05:00", "2026-10-06T21:00:00+05:00"], // both after the close: 0
  ];
  let rows;
  beforeAll(() => {
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    q.env.ss.getRangeByName("NV_HOLIDAYS").getCell(1, 1).setValue(q.date("2026-10-08T00:00:00+05:00"));
    cases.forEach((c, i) => {
      q.call("nvAppendRow", "leads", {
        num: `L-2026-${String(i + 1).padStart(4, "0")}`,
        created: q.date(c[0]),
        status: "В работе",
        firstReply: q.date(c[1]),
      });
    });
    // one lead without a reply
    q.call("nvAppendRow", "leads", {
      num: "L-2026-0099",
      created: q.date("2026-10-05T23:00:00+05:00"),
      status: "Новая",
    });
    const c = createComputer(q);
    c.computeTables();
    expect(c.errors).toEqual([]);
    rows = q.call("nvReadTable", "leads");
    p = q; // the helpers above use the project of the last setup
  }, 60_000);

  it("«Ответ, ч» is the working hours between the two moments, never negative and never above the real gap", () => {
    cases.forEach((c, i) => {
      const expected = Math.round(wh(c[0], c[1], HOLIDAYS) * 10) / 10;
      expect(rows[i].replyH, c.join(" → ")).toBeCloseTo(expected, 5);
      expect(rows[i].replyH).toBeGreaterThanOrEqual(0);
    });
  });

  it("«Ответить до» is two working hours from the opening of the window; for a lead with a reply it is still the term", () => {
    cases.forEach((c, i) => {
      const expected = addHours(c[0], 2, HOLIDAYS);
      const got = new Date(rows[i].replyDue).getTime();
      expect(Math.abs(got - new Date(expected).getTime()), c[0]).toBeLessThan(2000);
    });
    const night = rows.find((r) => r.num === "L-2026-0099");
    expect(new Date(night.replyDue).toISOString()).toBe(at("2026-10-06T12:00:00+05:00").toISOString());
  });

  it("the share of replies in time can never be above 100 %: the same condition in the numerator and in the denominator", () => {
    const f = p.run("nvKpiDefs().reply.sub");
    const parts = f.split("/COUNTIFS(");
    expect(parts).toHaveLength(2);
    // both COUNTIFS carry «>=0» over the same column
    expect(parts[0]).toContain('">=0"');
    expect(parts[1]).toContain('">=0"');
    expect(parts[0]).toContain('"<="&NV_FIRST_RESPONSE_HOURS');
  });
});

describe("«Сегодня»: a warning is not an overdue task", () => {
  const TODAY = () => p.call("nvToday");
  const tasks = (o = {}) => {
    const q = p;
    return JSON.parse(
      q.run(
        `JSON.stringify(nvTaskList(nvToday(), ${o.demo === true}).map((t) => ({ code: t.code, state: t.state, num: t.num, what: t.what, due: t.due.getTime() })))`,
      ),
    );
  };
  const clientOf = (tag) => p.call("nvEnsureClient", { name: `Клиент ${tag}`, tg: `@w_${tag}` });
  const orderAt = (tag, set) => {
    const num = p.call("nvCreateOrder", {
      client: clientOf(tag),
      kind: "ПК",
      basePc: 12_000_000,
      purchased: 12_000_000,
    });
    const row = read("orders").find((o) => o.num === num)._row;
    p.run(`nvWriteCells("orders", ${row}, ${JSON.stringify(set)})`);
    return num;
  };
  const day = (n) => new Date(TODAY().getTime() + n * 86400000);

  beforeAll(() => {
    p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
    p.call("nvSetup");
  }, 60_000);

  it("the warranty of an order shows for nine days around the date (7 before, 2 after), in a state that is not red", () => {
    const warrantyEnds = (days) => {
      const num = orderAt(`w${days}`, { status: "Закрыт", code: "closed", warrantyUntil: day(days) });
      return tasks().find((t) => t.code === "order_warranty_end" && t.num === num);
    };
    expect(warrantyEnds(30).state).toBe("Сегодня");
    expect(warrantyEnds(31).state).toBe("Завтра");
    expect(warrantyEnds(37).state).toBe("На неделе");
    expect(warrantyEnds(29).state).toBe("Предупреждение");
    expect(warrantyEnds(28).state).toBe("Предупреждение");
    // three days after the start the line is gone; it does not hang for 30 days
    expect(warrantyEnds(27)).toBeUndefined();
    expect(warrantyEnds(10)).toBeUndefined();
    expect(warrantyEnds(45)).toBeUndefined();
  });

  it("a warning is never counted as overdue by the tile and the digest", () => {
    const list = tasks();
    const warnings = list.filter((t) => t.state === "Предупреждение");
    expect(warnings.length).toBeGreaterThan(0);
    const model = JSON.parse(p.run("JSON.stringify(nvDashboardModel({}).kpis.overdue.value)"));
    expect(model).toBe(list.filter((t) => t.state === "Просрочено").length);
    expect(p.call("nvDigestText", p.env.now)).not.toContain("Предупреждение");
  });

  it("the aftercare and the credit of «Подбор» are the same kind of line", () => {
    const num = orderAt("after", { status: "Сдан", code: "handed_over", aftercare1: day(-1), aftercare2: day(25) });
    const t = tasks().filter((x) => x.num === num);
    expect(t.find((x) => x.code === "aftercare_7").state).toBe("Предупреждение");
    const podbor = orderAt("podbor", { status: "Подбор сдан", code: "podbor_delivered", podborUntil: day(7) });
    expect(tasks().find((x) => x.code === "podbor_credit" && x.num === podbor).state).toBe("Сегодня");
    const podbor2 = orderAt("podbor2", { status: "Подбор сдан", code: "podbor_delivered", podborUntil: day(5) });
    expect(tasks().find((x) => x.code === "podbor_credit" && x.num === podbor2).state).toBe("Предупреждение");
    const podbor3 = orderAt("podbor3", { status: "Подбор сдан", code: "podbor_delivered", podborUntil: day(4) });
    expect(tasks().find((x) => x.code === "podbor_credit" && x.num === podbor3)).toBeUndefined();
  });

  it("the warranty of the shops: one line for an order, not one for each receipt", () => {
    const num = orderAt("shops", { status: "Закрыт", code: "closed", warrantyUntil: day(300) });
    for (let i = 0; i < 9; i++) {
      p.call("nvAppendRow", "purchases", {
        id: `Z-2026-${String(900 + i).padStart(4, "0")}`,
        order: num,
        item: `Деталь ${i}`,
        amount: 100_000,
        bought: day(-335),
        warrantyMonths: 12,
        docKind: "Фискальный чек",
        receipt: `FS-${i}`,
      });
    }
    const c = createComputer(p);
    c.computeTables();
    const list = tasks().filter((t) => t.code === "shop_warranty_end");
    const mine = list.filter((t) => t.num === num);
    expect(mine).toHaveLength(1);
    // the formula of the sheet takes the nearest end of a shop warranty from the order row
    const row = read("orders").find((o) => o.num === num);
    expect(row.shopWarrantyNext).not.toBe("");
  });

  it("the threshold: one line after a new border, gone when the owner marks it as read", () => {
    const set = (key, v) => {
      const layout = JSON.parse(p.run("JSON.stringify(nvSettingsLayout().map((x) => ({ k: x.def.key, row: x.row })))"));
      p.env.ss
        .getSheetByName("Настройки")
        .getRange(layout.find((x) => x.k === key).row, 3)
        .setValue(v);
      p.call("nvResetSettingsCache");
    };
    // a deal of 700 million: the borders of 60 % and 70 % are crossed
    p.call("nvAppendRow", "purchases", {
      id: "Z-2026-0990",
      order: "",
      item: "Крупная",
      amount: 700_000_000,
      bought: day(-1),
    });
    expect(tasks().filter((t) => t.code === "threshold_alert")).toHaveLength(1);
    expect(tasks().find((t) => t.code === "threshold_alert").state).not.toBe("Просрочено");
    set("alertAckPct", 70);
    expect(tasks().filter((t) => t.code === "threshold_alert")).toHaveLength(0);
    set("alertAckPct", 0);
  });

  it("a lead that came at night is overdue only when the two working hours have passed", () => {
    const num = p.call(
      "nvCreateLead",
      { channel: "Сайт", scope: "ПК", name: "Ночной" },
      { now: at("2026-10-07T23:00:00+05:00") },
    );
    p.env.now = at("2026-10-08T01:00:00+05:00");
    let t = tasks().find((x) => x.code === "lead_no_reply" && x.num === num);
    expect(t.state).not.toBe("Просрочено");
    expect(new Date(t.due).toISOString()).toBe(at("2026-10-08T12:00:00+05:00").toISOString());
    p.env.now = at("2026-10-08T12:01:00+05:00");
    t = tasks().find((x) => x.code === "lead_no_reply" && x.num === num);
    expect(t.state).toBe("Просрочено");
    p.env.now = T0;
  });

  it("a receipt with the document «ЭСФ» but without the number already has the term of the signing", () => {
    const num = orderAt("esf", { status: "Закупка", code: "purchasing" });
    p.call("nvAppendRow", "purchases", {
      id: "Z-2026-0995",
      order: num,
      item: "Видеокарта",
      amount: 5_000_000,
      docKind: "ЭСФ",
      bought: day(-9),
    });
    const c = createComputer(p);
    c.computeTables();
    const pu = read("purchases").find((x) => x.id === "Z-2026-0995");
    expect(new Date(pu.esfDue).getTime()).toBe(day(1).getTime());
    expect(tasks().some((t) => t.code === "esf_due" && t.num === "Z-2026-0995")).toBe(true);
  });

  it("«Шаг: …» is not repeated when the order has a line of a rule", () => {
    const num = orderAt("step", {
      status: "Принят: ждём оплату",
      code: "accepted",
      dAccepted: day(-3),
      nextStep: "Напомнить об оплате",
      nextDate: day(0),
    });
    const mine = tasks().filter((t) => t.num === num);
    expect(mine.some((t) => t.code === "no_advance")).toBe(true);
    expect(mine.some((t) => t.code === "next_step")).toBe(false);
    const free = orderAt("step2", {
      status: "Смета: черновик",
      code: "estimate_draft",
      nextStep: "Собрать смету",
      nextDate: day(1),
    });
    expect(tasks().some((t) => t.code === "next_step" && t.num === free)).toBe(true);
  });
});

describe("«Сегодня»: the layout for a phone and the formula of the sheet", () => {
  const sh = () => p.env.ss.getSheetByName("Сегодня");
  it("the order of the columns: term, what to do, number, sum, state; the code of the rule is hidden, in the list too", () => {
    const heads = sh().getRange(5, 2, 1, 10).getValues()[0];
    expect(heads.slice(0, 5)).toEqual(["Срок", "Что сделать", "Номер", "Сумма, сум", "Состояние срока"]);
    expect(heads[5]).toBe("Объект");
    expect(heads[6]).toBe("Клиент");
    expect(heads[7]).toBe("Правило");
    expect(sh().isColumnHiddenByUser(2 + 7)).toBe(true);
    expect(sh().isColumnHiddenByUser(2 + 8)).toBe(true);
  });
  it("the first two columns fit the width of a phone (412 px)", () => {
    const w = (c) => sh().colW.get(c);
    expect(w(1) + w(2) + w(3)).toBeLessThanOrEqual(412);
    expect(sh().getFrozenColumns()).toBeLessThanOrEqual(1);
  });
  it("the formula puts the columns in that order, labels a past warning «Предупреждение» and drops the repeated «Шаг»", () => {
    const f = sh()._cell(6, 2).f;
    expect(f).toContain("Предупреждение");
    expect(f).toContain("next_step");
    expect(f).toContain("CHOOSECOLS(u, 2, 4, 6)");
    expect(f).toContain("CHOOSECOLS(u, 3, 5, 7, 8)");
    expect(f).toContain("order_warranty_end");
  });
  it("the state is shown by the colour of the term and the line; «Открыть» has the colour of the text, not the orange", () => {
    const T = JSON.parse(p.run("JSON.stringify(NV_THEMES.passport)"));
    const open = sh()._cell(6, 2 + 9);
    expect(open.fc).toBe(T.text);
    const rules = sh().cf.map((r) => r.formula);
    expect(rules.join("\n")).toContain("Предупреждение");
  });
  it("the digest reads the same columns: the rows of the demo and the free text of the steps are not in it", () => {
    const rows = [
      ["07.10.2026", "Ответить на новую заявку", "L-2026-0001", 0, "Просрочено", "Заявка", "Алишер", "lead_no_reply"],
      [
        "07.10.2026",
        "Шаг: позвонить Алишеру по номеру 90 123",
        "NV-2026-0002",
        1_000_000,
        "Сегодня",
        "Заказ",
        "Бобур",
        "next_step",
      ],
      [
        "07.10.2026",
        "Ответить на новую заявку",
        "L-2026-D001",
        0,
        "Просрочено",
        "Заявка",
        "Демо-клиент 1",
        "lead_no_reply",
      ],
      [
        "10.10.2026",
        "Гарантия заказа истекает через 30 дней",
        "NV-2026-0003",
        0,
        "Предупреждение",
        "Заказ",
        "",
        "order_warranty_end",
      ],
    ];
    for (const [i, r] of rows.entries())
      sh()
        .getRange(6 + i, 2, 1, 8)
        .setValues([r]);
    const text = p.call("nvDigestText", p.env.now);
    expect(text).toContain("L-2026-0001");
    expect(text).not.toContain("D001");
    expect(text).not.toContain("Алишеру");
    expect(text).not.toContain("90 123");
    expect(text).toContain("NV-2026-0002");
    expect(text).not.toContain("NV-2026-0003");
    for (let i = 0; i < rows.length; i++)
      sh()
        .getRange(6 + i, 2, 1, 8)
        .clearContent();
  });
});
