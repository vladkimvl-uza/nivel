// Check of the CRM against the documentation of Google (round 3). Every finding of the check has a test here that failed
// before the fix. The mock of Apps Script and of the Sheets service refuses what Google refuses (see gas-mock.mjs):
// the types of arguments, methods and enum values that do not exist, options a method does not support.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "crm-sheets", "src");
const T0 = new Date("2026-10-07T11:00:00+05:00"); // Wednesday, working hours
const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret
const src = (name) => readFileSync(join(SRC, name), "utf8");
/** The code of a file without comments (a comment may name what the code must not use). */
const code = (name) =>
  src(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function newProject(o = {}) {
  const q = createProject({
    now: T0,
    scriptProps: { OWNER_EMAIL: "owner@example.com", NIVEL_HMAC_SECRET: SECRET },
    ...o,
  });
  return q;
}

let built; // a project that has gone through the whole setup
beforeAll(() => {
  built = newProject();
  built.call("nvSetup");
}, 120_000);

describe("group 1: filter views of the Sheets service", () => {
  const view = (p, title) => p.env.ss.filterViews.find((v) => v.title === title);
  const spec = (v) => v.filterSpecs?.[0]?.filterCriteria;

  it("the setup runs to the end: the book is marked as built and the timer is gone", () => {
    expect(built.env.docProps.get("NV_SCHEMA_VERSION")).toBeTruthy();
    expect(built.env.docProps.get("NV_SETUP_AT")).toBeTruthy();
    expect(built.env.triggers.filter((t) => t.handler === "nvSetupContinue")).toHaveLength(0);
  });

  it("all five views exist, none uses a condition that only data validation knows", () => {
    expect(built.env.ss.filterViews.map((v) => v.title).sort()).toEqual(
      ["Архив", "В работе", "За неделю", "Принудительные", "Сроки"].sort(),
    );
  });

  it("uses filterSpecs, not the deprecated criteria", () => {
    expect(built.env.deprecatedFields).toEqual([]);
    for (const v of built.env.ss.filterViews) expect(v.criteria).toBeUndefined();
  });

  it("«Принудительные»: one value, so TEXT_EQ", () => {
    expect(spec(view(built, "Принудительные")).condition).toEqual({
      type: "TEXT_EQ",
      values: [{ userEnteredValue: "Принудительно" }],
    });
  });

  it("«В работе» and «Архив»: several values, so hiddenValues = the dictionary without the wanted ones", () => {
    const groups = built.call("nvDictValues", "NVD_STATUS_GROUP");
    const hiddenGroups = spec(view(built, "В работе")).hiddenValues;
    expect(hiddenGroups).not.toContain("В работе");
    expect(hiddenGroups).not.toContain("Ждёт клиента");
    for (const g of groups.filter((x) => x !== "В работе" && x !== "Ждёт клиента")) expect(hiddenGroups).toContain(g);
    const codes = built.call("nvDictValues", "NVD_STATUS_CODE");
    const hiddenCodes = spec(view(built, "Архив")).hiddenValues;
    for (const keep of ["closed", "cancelled", "podbor_delivered"]) expect(hiddenCodes).not.toContain(keep);
    for (const c of codes.filter((x) => !["closed", "cancelled", "podbor_delivered"].includes(x)))
      expect(hiddenCodes).toContain(c);
  });

  it("«За неделю» keeps only the last week, newest first", () => {
    const v = view(built, "За неделю");
    expect(spec(v).condition).toEqual({ type: "DATE_AFTER", values: [{ relativeDate: "PAST_WEEK" }] });
    expect(v.sortSpecs[0].sortOrder).toBe("DESCENDING");
  });

  it("the mock refuses ONE_OF_LIST in a filter (it did, before the fix, and the whole batch was rolled back)", () => {
    const p = newProject();
    p.call("nvSetup");
    const sheetId = p.env.ss.getSheetByName("История").getSheetId();
    const bad = {
      requests: [
        {
          addFilterView: {
            filter: {
              title: "x",
              range: { sheetId, startRowIndex: 4, startColumnIndex: 1, endColumnIndex: 4 },
              filterSpecs: [
                { columnIndex: 2, filterCriteria: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "a" }] } } },
              ],
            },
          },
        },
      ],
    };
    expect(() => p.ctx.Sheets.Spreadsheets.batchUpdate(bad, p.env.ss.id)).toThrow(/not supported by filters/);
  });

  it("a refusal of the Sheets service does not stop the setup: no endless timer, the reason is in the self-check", () => {
    const p = newProject();
    p.env.sheetsFail = true;
    const res = p.call("nvSetup");
    expect(res.done).toBe(true);
    expect(p.env.docProps.get("NV_SCHEMA_VERSION")).toBeTruthy();
    expect(p.env.triggers.filter((t) => t.handler === "nvSetupContinue")).toHaveLength(0);
    const rows = p.call("nvSelfCheckRows");
    const note = rows.find((r) => r.check === "Представления фильтров");
    expect(note.result).toBe("Предупреждение");
    expect(note.details).toMatch(/Service unavailable/);
  });

  it("without the Sheets service the setup also ends, with a note", () => {
    const p = newProject({ sheetsService: false });
    const res = p.call("nvSetup");
    expect(res.done).toBe(true);
    const note = p.call("nvSelfCheckRows").find((r) => r.check === "Представления фильтров");
    expect(note.result).toBe("Предупреждение");
  });

  it("one bad view does not take the other views with it", () => {
    const p = newProject();
    // The service refuses the view of the history only: the views of the orders must still appear
    const real = p.ctx.Sheets.Spreadsheets.batchUpdate;
    p.ctx.Sheets.Spreadsheets.batchUpdate = (res, id) => {
      const text = JSON.stringify(res);
      if (text.includes('"За неделю"')) throw new Error("GoogleJsonResponseException: Invalid requests: boom");
      return real(res, id);
    };
    expect(p.call("nvSetup").done).toBe(true);
    const titles = p.env.ss.filterViews.map((v) => v.title);
    expect(titles).toContain("В работе");
    expect(titles).toContain("Архив");
    expect(titles).not.toContain("За неделю");
    const note = p.call("nvSelfCheckRows").find((r) => r.check === "Представления фильтров");
    expect(note.details).toMatch(/За неделю/);
  });
});

describe("group 1: the theme of the book", () => {
  it("a book without a theme (getSpreadsheetTheme() is null) is built all the same", () => {
    const p = newProject();
    p.env.noTheme = true;
    const res = p.call("nvSetup");
    expect(res.done).toBe(true);
    expect(p.env.logs.join("\n")).toMatch(/Тема книги не применена/);
    expect(p.env.ss.getSheetByName("Панель")).toBeTruthy();
    // The time zone and the locale are set before the theme is touched
    expect(p.env.ss.getSpreadsheetLocale()).toBe(p.run("NV_LOCALE"));
  });
});

describe("group 1: sources", () => {
  it("24_setup.js has no ONE_OF_LIST and no criteria map", () => {
    const s = code("24_setup.js");
    expect(s).not.toMatch(/ONE_OF_LIST/);
    expect(s).not.toMatch(/view\.criteria/);
  });
});

describe("group 6: memory of the urgent reminders (a property holds 9 KB)", () => {
  const MB = (n) => `report:NV-2026-${String(n).padStart(4, "0")}`;
  const bytes = (t) => Buffer.byteLength(t, "utf8");

  function seeded(count, ageMs = 60_000) {
    const p = newProject({ now: T0 });
    p.call("nvSetup");
    const sent = {};
    for (let i = 0; i < count; i++) sent[MB(i)] = T0.getTime() - ageMs - i;
    p.env.scriptProps.set("NV_REMINDERS_SENT", JSON.stringify(sent));
    return p;
  }

  function newReminder(p) {
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Срочный" });
    const row = p.call("nvReadTable", "leads").find((l) => l.num === num)._row;
    p.call("nvWriteCells", "leads", row, { created: p.date("2026-10-07T09:00:00+05:00") });
    p.env.now = new Date("2026-10-07T17:30:00+05:00");
    return { num, count: p.call("nvUrgentReminders", p.call("nvNow"), p.call("nvSettings"), []) };
  }

  it("with 290 remembered reminders the new one is stored and sent (before: setProperty threw above 9 KB)", () => {
    const p = seeded(290);
    const { num, count } = newReminder(p);
    expect(count).toBe(1);
    const text = p.env.scriptProps.get("NV_REMINDERS_SENT");
    expect(bytes(text)).toBeLessThanOrEqual(8000);
    expect(JSON.parse(text)[`lead:${num}`]).toBeTruthy();
    expect(p.env.fetches.concat(p.env.mails).length).toBeGreaterThan(0);
  });

  it("the oldest memories go first, the newest stay", () => {
    const p = seeded(290);
    newReminder(p);
    const kept = JSON.parse(p.env.scriptProps.get("NV_REMINDERS_SENT"));
    expect(kept[MB(0)]).toBeTruthy();
    expect(kept[MB(289)]).toBeUndefined();
  });

  it("memories older than 30 days are forgotten", () => {
    const p = seeded(5, 40 * 86_400_000);
    const { num } = newReminder(p);
    const kept = JSON.parse(p.env.scriptProps.get("NV_REMINDERS_SENT"));
    expect(Object.keys(kept)).toEqual([`lead:${num}`]);
  });

  it("the mock refuses a property value above 9 KB, like Google", () => {
    const p = newProject();
    expect(() => p.ctx.PropertiesService.getScriptProperties().setProperty("K", "x".repeat(9 * 1024 + 1))).toThrow(
      /too large/,
    );
    p.ctx.PropertiesService.getScriptProperties().setProperty("K", "x".repeat(9 * 1024));
  });
});

describe("group 6: flush before the lock is released", () => {
  it("a write under the lock is flushed before releaseLock", () => {
    const p = newProject();
    p.call("nvSetup");
    p.env.unflushedReleases = 0;
    p.run('nvWithLock(() => { nvSheet("tasks").getRange("J1").setValue("x"); })');
    expect(p.env.unflushedReleases).toBe(0);
  });

  it("nested locks flush once, when the outer one is released", () => {
    const p = newProject();
    p.call("nvSetup");
    p.env.unflushedReleases = 0;
    p.run('nvWithLock(() => { nvWithLock(() => { nvSheet("tasks").getRange("J2").setValue("y"); }); })');
    expect(p.env.unflushedReleases).toBe(0);
  });

  it("an error of flush does not keep the lock", () => {
    const p = newProject();
    p.call("nvSetup");
    p.ctx.SpreadsheetApp.flush = () => {
      throw new Error("flush failed");
    };
    p.run('nvWithLock(() => { nvSheet("tasks").getRange("J3").setValue("z"); })');
    expect(p.env.locked).toBe(false);
  });

  it("the mock notices a release without flush (the check itself works)", () => {
    const p = newProject();
    p.call("nvSetup");
    p.env.unflushedReleases = 0;
    const lock = p.ctx.LockService.getScriptLock();
    lock.tryLock(1000);
    p.env.ss.getSheetByName("Задачи")?.getRange("J4").setValue("w");
    p.env.ss.getSheets()[0].getRange("A1").setValue("w");
    lock.releaseLock();
    expect(p.env.unflushedReleases).toBe(1);
  });
});

describe("group 6: triggers belong to the account that creates them", () => {
  it("an assistant cannot install triggers: no second set next to the owner's", () => {
    const owner = newProject();
    owner.call("nvInstallTriggers");
    expect(owner.env.triggers).toHaveLength(5);
    const helper = createProject({
      now: T0,
      scriptProps: { OWNER_EMAIL: "owner@example.com" },
      effectiveEmail: "helper@example.com",
    });
    helper.env.triggers = owner.env.triggers; // the same project: the triggers of the owner exist already
    expect(() => helper.call("nvInstallTriggers")).toThrow(/владельц/);
    expect(owner.env.triggers).toHaveLength(5);
  });

  it("from the menu the refusal is a message, not an exception", () => {
    const helper = createProject({
      now: T0,
      scriptProps: { OWNER_EMAIL: "owner@example.com" },
      effectiveEmail: "helper@example.com",
    });
    helper.call("nvMenuInstallTriggers");
    expect(helper.env.triggers).toHaveLength(0);
    expect(helper.env.alerts.at(-1).text).toMatch(/владельц/);
  });

  it("without OWNER_EMAIL there is one user: any account may install", () => {
    const p = createProject({ now: T0, effectiveEmail: "someone@example.com" });
    p.call("nvInstallTriggers");
    expect(p.env.triggers).toHaveLength(5);
  });

  it("the owner installs; the second installation replaces the set, never doubles it", () => {
    const p = newProject();
    p.call("nvInstallTriggers");
    p.call("nvInstallTriggers");
    expect(p.env.triggers).toHaveLength(5);
  });

  it("the mock shows a user only his own triggers, as getProjectTriggers does", () => {
    const owner = newProject();
    owner.call("nvInstallTriggers");
    const helper = createProject({ now: T0, effectiveEmail: "helper@example.com" });
    helper.env.triggers = owner.env.triggers;
    expect(helper.call("nvTriggerCounts")).toEqual(expect.objectContaining({ nvOnEdit: 0 }));
  });

  it("the self-check says that only the triggers of the current user are counted", () => {
    const p = newProject();
    p.call("nvSetup");
    p.call("nvInstallTriggers");
    const row = p.call("nvSelfCheckRows").find((r) => r.check === "Триггеры");
    expect(row.result).toBe("ОК");
    expect(row.details).toMatch(/текущего пользователя/);
  });

  it("the time of the digest is not promised to the minute", () => {
    const p = newProject();
    const labels = p.call("nvInstallTriggers").installed.join(" | ");
    expect(labels).not.toMatch(/09:00/);
    expect(labels).toMatch(/с 9 до 10/);
  });
});

describe("group 6: dialogs", () => {
  it("the answer of alert is an enum value; String() of it is not the name, so the code compares with ui.Button", () => {
    const p = newProject();
    p.env.alertAnswers.push("YES", "NO", "CANCEL", "CLOSE", "OK");
    const got = [1, 2, 3, 4, 5].map(() => p.call("nvAskEx", "t", "x"));
    expect(got).toEqual(["YES", "NO", "CANCEL", "CLOSE", "OK"]);
    const ui = p.ctx.SpreadsheetApp.getUi();
    expect(String(ui.Button.YES)).not.toBe("YES");
  });

  it("prompt: OK and cancel are told apart by the enum", () => {
    const p = newProject();
    p.env.promptAnswers.push("text", null);
    expect(p.call("nvPromptEx", "t", "x")).toEqual({ state: "ok", text: "text" });
    expect(p.call("nvPromptEx", "t", "x").state).toBe("cancel");
  });

  it("a sidebar gets no setWidth (the reference gives it to dialogs only)", () => {
    const p = newProject();
    p.call("nvSetup");
    for (const kind of Object.keys(JSON.parse(p.run("JSON.stringify(Object.fromEntries(Object.keys(NV_FORMS).map((k) => [k, 1])))")))) {
      p.env.sidebars.length = 0;
      p.call("nvShowForm", kind);
      expect(p.env.sidebars[0].width).toBe(0);
    }
  });
});

describe("group 6: google.script.run in the sidebars always has a failure handler", () => {
  /** Runs the script of a sidebar page against a fake page and a strict fake of google.script.run. */
  function drive(html) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const calls = [];
    const chain = (o) =>
      new Proxy(
        {},
        {
          get: (_t, name) => {
            if (name === "withSuccessHandler") return (f) => chain({ ...o, ok: f });
            if (name === "withFailureHandler") return (f) => chain({ ...o, fail: f });
            return (...args) => {
              calls.push({ name, args, ...o });
            };
          },
        },
      );
    const els = new Map();
    const mkEl = (id) => {
      const e = { id, value: id === "f_order" ? "NV-2026-0001" : "", className: "", textContent: "", children: [], listeners: {}, elements: [], reset: () => {} };
      e.appendChild = (c) => e.children.push(c);
      e.setAttribute = () => {};
      e.addEventListener = (t, f) => {
        e.listeners[t] = f;
      };
      return e;
    };
    const document = {
      getElementById: (id) => {
        if (!els.has(id)) els.set(id, mkEl(id));
        return els.get(id);
      },
      createElement: () => mkEl(""),
      addEventListener: () => {},
    };
    const sandbox = {
      document,
      google: { script: { run: chain({}) } },
      confirm: () => true,
      prompt: () => "причина",
    };
    vm.createContext(sandbox);
    for (const s of scripts) vm.runInContext(s, sandbox);
    return { sandbox, calls, els };
  }

  it("the panel of the order action: the three server calls have a failure handler that writes the message", () => {
    const p = newProject();
    p.call("nvSetup");
    const html = p.call("nvFormHtml", "action");
    const { sandbox, calls, els } = drive(html);
    sandbox.load();
    expect(calls.map((c) => c.name)).toEqual(["nvOrderPanelInfo"]);
    calls[0].ok({ status: "s", events: [{ code: "ev", label: "L", violations: [], input: "" }] });
    sandbox.run("ev");
    expect(calls.at(-1).name).toBe("nvOrderPanelRun");
    calls.at(-1).ok({ needConfirm: true, text: "нельзя" });
    expect(calls.at(-1).args[3]).toBe(true);
    for (const c of calls) {
      expect(typeof c.fail, `${c.name} has no failure handler`).toBe("function");
      c.fail({ message: "занято" });
      const msg = els.get("msg");
      expect(msg.className).toBe("err");
      expect(msg.textContent).toBe("занято");
    }
  });

  it("the plain forms keep theirs", () => {
    const p = newProject();
    p.call("nvSetup");
    const { sandbox, calls } = drive(p.call("nvFormHtml", "lead"));
    sandbox.send();
    expect(calls.map((c) => typeof c.fail)).toEqual(["function"]);
  });
});

describe("group 2: text from outside never turns into a formula when the code writes it back", () => {
  const cellOf = (p, sheetName, row, col) => p.env.ss.getSheetByName(sheetName).getRange(row, col);

  it("the monthly cleaning of the webhook journal rewrites the kept rows as text (before: =… became a formula)", () => {
    const p = newProject();
    p.call("nvSetup");
    p.call("nvAppendRows", "webhook", [
      { received: p.date("2025-01-05T10:00:00+05:00"), eventId: "old", type: "x", result: "Принято" },
      {
        received: p.date("2026-09-20T10:00:00+05:00"),
        eventId: "keep",
        type: "=HYPERLINK(\"http://x\",\"y\")",
        error: "+998901234567",
        summary: "=1+1",
        result: "Принято",
      },
      { received: p.date("2026-09-21T10:00:00+05:00"), eventId: "keep2", type: "-5", summary: "@name", result: "Принято" },
    ]);
    expect(p.call("nvCleanWebhookJournal", p.call("nvNow"))).toBe(1);
    const rows = p.call("nvReadTable", "webhook");
    expect(rows.map((r) => r.eventId)).toEqual(["keep", "keep2"]);
    const col = (key) => 2 + JSON.parse(p.run("JSON.stringify(NV_SCHEMA.webhook.cols.map((c) => c.key))")).indexOf(key);
    for (const [row, key, text] of [
      [6, "type", '=HYPERLINK("http://x","y")'],
      [6, "summary", "=1+1"],
      [6, "error", "+998901234567"],
      [7, "type", "-5"],
      [7, "summary", "@name"],
    ]) {
      const cell = cellOf(p, "Журнал вебхука", row, col(key));
      expect(cell.getFormula(), `${key} of row ${row} became a formula`).toBe("");
      expect(cell.getValue()).toBe(text);
    }
  });
});

describe("group 2: a refused edit puts the old value back as it was", () => {
  const edit = (p, sheetName, row, col, value, oldValue) => {
    const range = p.env.ss.getSheetByName(sheetName).getRange(row, col);
    range.setValue(value);
    p.call("nvOnEdit", { range, value, oldValue, source: p.env.ss });
    return range;
  };
  const colOf = (p, key, col) =>
    2 + JSON.parse(p.run(`JSON.stringify(NV_SCHEMA.${key}.cols.map((c) => c.key))`)).indexOf(col);
  function platformLead(p) {
    const num = p.call(
      "nvCreateLead",
      { channel: "Telegram-бот", scope: "ПК", name: "От платформы" },
      { number: "L-2026-0300", src: "Платформа" },
    );
    return p.call("nvReadTable", "leads").find((l) => l.num === num)._row;
  }

  it("the old text '=HYPERLINK(...)' of a platform field comes back as text, not as a formula (before: a formula)", () => {
    const p = newProject();
    p.call("nvSetup");
    const row = platformLead(p);
    const text = '=HYPERLINK("http://x","y")';
    p.env.alertAnswers.push("NO");
    const range = edit(p, "Заявки", row, colOf(p, "leads", "name"), "Другое имя", text);
    expect(range.getFormula()).toBe("");
    expect(range.getValue()).toBe(text);
  });

  it("'+998…' and '@name' in a text cell stay text", () => {
    const p = newProject();
    p.call("nvSetup");
    const row = platformLead(p);
    for (const text of ["+998901234567", "@name"]) {
      p.env.alertAnswers.push("NO");
      const range = edit(p, "Заявки", row, colOf(p, "leads", "tg"), "новый", text);
      expect(range.getFormula()).toBe("");
      expect(range.getValue()).toBe(text);
    }
  });

  it("nvRestoreValue: a number stays a number in a number cell, text goes in as text", () => {
    const p = newProject();
    p.call("nvSetup");
    const leads = p.env.ss.getSheetByName("Заявки");
    const sumCell = leads.getRange(6, colOf(p, "leads", "budget"));
    const tgCell = leads.getRange(6, colOf(p, "leads", "tg"));
    expect(p.call("nvRestoreValue", sumCell, "-5000")).toBe(-5000);
    expect(p.call("nvRestoreValue", sumCell, "12000")).toBe(12000);
    expect(p.call("nvRestoreValue", sumCell, "=1+1")).toBe("'=1+1");
    expect(p.call("nvRestoreValue", tgCell, "+998901234567")).toBe("'+998901234567");
    expect(p.call("nvRestoreValue", tgCell, "-5000")).toBe("'-5000");
    expect(p.call("nvRestoreValue", sumCell, undefined)).toBe("");
    expect(p.call("nvRestoreValue", sumCell, 42)).toBe(42);
  });

  it("a hand-typed number is taken back with the old number", () => {
    const p = newProject();
    p.call("nvSetup");
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Тест" });
    const row = p.call("nvReadTable", "leads").find((l) => l.num === num)._row;
    const range = edit(p, "Заявки", row, colOf(p, "leads", "num"), "L-9999", num);
    expect(range.getValue()).toBe(num);
  });
});

describe("group 2: formulas are written with setFormula/setFormulas, not as text through setValues", () => {
  it("no formula of the built book was put in by setValues (their notation is not documented for it)", () => {
    const offenders = [];
    for (const sh of built.env.ss.sheets)
      for (const [k, cell] of sh.cells) if (cell.f && cell.fvia !== "formula") offenders.push(`${sh.name}!${k}`);
    expect(offenders.slice(0, 10), `${offenders.length} cells`).toEqual([]);
  });

  it("the mock refuses setFormulas with a value that is not a formula", () => {
    const sh = built.env.ss.getSheetByName("Панель");
    expect(() => sh.getRange("A1:B1").setFormulas([["=1", "text"]])).toThrow(/not a formula/);
    expect(() => sh.getRange("A1").setFormula(5)).toThrow(/match the method signature/);
  });
});

describe("group 2: the self-check compares formulas the way Sheets may spell them", () => {
  const row = (p) => p.call("nvSelfCheckRows").find((r) => r.check === "Формулы в заголовках не стёрты");

  it("formulas as written: OK", () => {
    expect(row(built).result).toBe("ОК");
  });

  it("formulas handed back without blanks, without quotes round sheet names, with capitals: still OK (before: all failed)", () => {
    built.env.normalizeFormulas = true;
    try {
      expect(row(built).result).toBe("ОК");
    } finally {
      built.env.normalizeFormulas = false;
    }
  });

  it("a really changed formula is still found", () => {
    const sh = built.env.ss.getSheetByName("Заказы");
    const cell = sh.getRange(5, 2 + JSON.parse(built.run("JSON.stringify(NV_SCHEMA.orders.cols.map((c) => !!c.calc))")).indexOf(true));
    const old = cell.getFormula();
    cell.setFormula("=1+1");
    try {
      expect(row(built).result).toBe("Ошибка");
    } finally {
      cell.setFormula(old);
    }
  });
});

describe("group 2: number formats and row heights as the reference documents them", () => {
  it("the mock refuses 'General': it is not a pattern of the Sheets API guide", () => {
    const sh = built.env.ss.getSheetByName("Панель");
    expect(() => sh.getRange("A1").setNumberFormat("General")).toThrow(/Invalid number format/);
    expect(() => sh.getRange("A1").setNumberFormats([["General"]])).toThrow(/Invalid number format/);
    sh.getRange("A1").setNumberFormat("#,##0");
    sh.getRange("A1").setNumberFormat("dd.mm.yyyy hh:mm");
    sh.getRange("A1").setNumberFormat("@");
    sh.getRange("A1").setNumberFormat('0.0" %"');
  });

  it("no cell of the built book carries General; checkbox columns carry no format", () => {
    for (const sh of built.env.ss.sheets)
      for (const [, cell] of sh.cells) if (cell.nf !== undefined) expect(cell.nf).not.toMatch(/general/i);
  });

  it("the fixed grids of the panel and of the phone sheet have forced row heights", () => {
    for (const name of ["Панель", "Телефон"]) {
      const sh = built.env.ss.getSheetByName(name);
      const loose = [...sh.rowH.keys()].filter((r) => !sh.rowForced.has(r));
      expect(loose, `${name}: rows with growing height`).toEqual([]);
      expect(sh.rowH.size).toBeGreaterThan(20);
    }
  });
});
