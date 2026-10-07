// Check of the CRM against the documentation of Google (round 3). Every finding of the check has a test here that failed
// before the fix. The mock of Apps Script and of the Sheets service refuses what Google refuses (see gas-mock.mjs):
// the types of arguments, methods and enum values that do not exist, options a method does not support.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { createComputer } from "../crm-sheets/scripts/computed.mjs";
import { createProject } from "../crm-sheets/scripts/env.mjs";
import { calc } from "../crm-sheets/scripts/formula-eval.mjs";
import { lintFormula } from "../crm-sheets/scripts/formula-lint.mjs";

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
                {
                  columnIndex: 2,
                  filterCriteria: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "a" }] } },
                },
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
    for (const kind of Object.keys(
      JSON.parse(p.run("JSON.stringify(Object.fromEntries(Object.keys(NV_FORMS).map((k) => [k, 1])))")),
    )) {
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
      const e = {
        id,
        value: id === "f_order" ? "NV-2026-0001" : "",
        className: "",
        textContent: "",
        children: [],
        listeners: {},
        elements: [],
        reset: () => {},
      };
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
        type: '=HYPERLINK("http://x","y")',
        error: "+998901234567",
        summary: "=1+1",
        result: "Принято",
      },
      {
        received: p.date("2026-09-21T10:00:00+05:00"),
        eventId: "keep2",
        type: "-5",
        summary: "@name",
        result: "Принято",
      },
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
    const cell = sh.getRange(
      5,
      2 + JSON.parse(built.run("JSON.stringify(NV_SCHEMA.orders.cols.map((c) => !!c.calc))")).indexOf(true),
    );
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

// ---------------------------------------------------------------------------------------------------------------------
// group 3: data validation, protection, banding, column groups

const json = (p, code) => JSON.parse(p.run(`JSON.stringify(${code})`));
const dvList = (p) => {
  const seen = new Set();
  const out = [];
  for (const sh of p.env.ss.sheets)
    for (const [k, c] of sh.cells)
      if (c.dv && !seen.has(c.dv)) {
        seen.add(c.dv);
        out.push({ sheet: sh.name, at: k, dv: c.dv });
      }
  return out;
};

function colLetterOf(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

describe("group 3: whole numbers in the settings are checked as whole numbers", () => {
  const rowsOf = (p, type) =>
    json(p, "nvSettingsLayout()").filter((x) => !x.isGroup && x.def.type === type && !x.def.readonly);
  const accepts = (p, row, value) => {
    const dv = p.env.ss.getSheetByName("Настройки")._cell(row, 3).dv;
    expect(dv.type, `row ${row}`).toBe("formula");
    const ctx = {
      sheetName: "Настройки",
      getCell: (_s, r, c) => (r === row && c === 3 ? value : null),
      maxRows: () => 1000,
      maxCols: () => 26,
      named: () => null,
      now: T0,
      rowRef: () => null,
    };
    try {
      return calc(dv.formula, ctx) === true;
    } catch {
      return false;
    }
  };

  it("basis points: 0 to 10 000, whole", () => {
    const row = rowsOf(built, "bp")[0].row;
    expect(accepts(built, row, 1500)).toBe(true);
    expect(accepts(built, row, 0)).toBe(true);
    expect(accepts(built, row, 10000)).toBe(true);
    expect(accepts(built, row, 1500.5)).toBe(false);
    expect(accepts(built, row, -1)).toBe(false);
    expect(accepts(built, row, 10001)).toBe(false);
    expect(accepts(built, row, "abc")).toBe(false);
  });

  it("sums and whole numbers: not below 0, whole (a sum of 12,7 was accepted)", () => {
    for (const type of ["sum", "int"]) {
      const row = rowsOf(built, type)[0].row;
      expect(accepts(built, row, 12), type).toBe(true);
      expect(accepts(built, row, 0), type).toBe(true);
      expect(accepts(built, row, 12.7), type).toBe(false);
      expect(accepts(built, row, -3), type).toBe(false);
      expect(accepts(built, row, "x"), type).toBe(false);
    }
  });

  it("every editable numeric setting has its own rule that names its own row", () => {
    for (const type of ["bp", "sum", "int"])
      for (const x of rowsOf(built, type)) {
        const dv = built.env.ss.getSheetByName("Настройки")._cell(x.row, 3).dv;
        expect(dv.formula, `${x.def.name}`).toContain(`C${x.row}`);
      }
  });
});

describe("group 3: only the cells that may be typed in are open in a protected sheet", () => {
  it("no open cell holds a formula; on the settings sheet exactly the editable rows are open", () => {
    for (const sh of built.env.ss.sheets) {
      const prot = sh.sheetProtection;
      if (!prot) continue;
      for (const r of prot.unprotected)
        for (let row = r.getRow(); row <= r.getLastRow(); row++)
          for (let col = r.getColumn(); col <= r.getLastColumn(); col++) {
            const cell = sh.cells.get(`${row},${col}`);
            expect(Boolean(cell?.f), `${sh.name}!${colLetterOf(col)}${row} is open and holds a formula`).toBe(false);
          }
    }
    const layout = json(built, "nvSettingsLayout()");
    const sh = built.env.ss.getSheetByName("Настройки");
    const open = new Set();
    for (const r of sh.sheetProtection.unprotected)
      for (let row = r.getRow(); row <= r.getLastRow(); row++) open.add(row);
    const editable = layout.filter((x) => !x.isGroup && !x.def.readonly && x.def.type !== "formula").map((x) => x.row);
    expect([...open].sort((a, b) => a - b)).toEqual(editable);
  });

  it("the calculator keeps the formula of the reserve closed", () => {
    const sh = built.env.ss.getSheetByName("Калькулятор");
    const open = new Set();
    for (const r of sh.sheetProtection.unprotected)
      for (let row = r.getRow(); row <= r.getLastRow(); row++) open.add(row);
    expect(open.has(23)).toBe(true);
    expect(open.has(24)).toBe(false);
  });
});

describe("group 3: protection that the owner set by hand is not removed", () => {
  it("a sheet protected by hand keeps its protection; the self-check says so and the setup goes on", () => {
    const p = newProject();
    p.call("nvSetup");
    const sh = p.env.ss.getSheetByName("Панель");
    sh.sheetProtection.remove();
    const own = sh.protect();
    own.setDescription("Только я правлю панель");
    p.call("nvProtectPanel");
    expect(sh.sheetProtection).toBe(own);
    expect(own.getDescription()).toBe("Только я правлю панель");
    expect(own.isWarningOnly()).toBe(false);
    const row = p.call("nvSelfCheckRows").find((r) => r.check === "Защита: Панель");
    expect(row.result).toBe("Предупреждение");
  });

  it("our own warning is replaced as before, and no note is left", () => {
    const p = newProject();
    p.call("nvSetup");
    p.call("nvProtectPanel");
    p.call("nvProtectSpecial");
    const sh = p.env.ss.getSheetByName("Панель");
    expect(sh.sheetProtection.getDescription()).toMatch(/^Nivel:/);
    expect(sh.sheetProtection.isWarningOnly()).toBe(true);
    expect(p.call("nvSelfCheckRows").some((r) => r.check.startsWith("Защита:"))).toBe(false);
  });

  it("protect() on a protected sheet returns the existing protection (the mock shows the rule)", () => {
    const sh = built.env.ss.getSheetByName("Телефон");
    expect(sh.protect()).toBe(sh.protect());
  });
});

describe("group 3: checkboxes refuse typed text", () => {
  it("every checkbox rule of the book has setAllowInvalid(false)", () => {
    built.call("nvFlagValidations", "orders", 6, 3);
    built.call("nvFlagValidations", "payments", 6, 3);
    const boxes = dvList(built).filter((x) => x.dv.type === "checkbox");
    expect(boxes.length).toBeGreaterThan(5);
    expect(boxes.filter((x) => x.dv.allowInvalid !== false).map((x) => `${x.sheet}!${x.at}`)).toEqual([]);
  });
});

describe("group 3: the list of order numbers follows the growth of the orders sheet", () => {
  it("after rows are added to the orders the checks of purchases, payments and warranty reach the new last row", () => {
    const p = newProject();
    p.call("nvSetup");
    const orders = p.env.ss.getSheetByName("Заказы");
    const before = orders.getMaxRows();
    p.call("nvEnsureCapacity", "orders", before);
    const last = orders.getMaxRows();
    expect(last).toBeGreaterThan(before);
    for (const key of ["purchases", "payments", "warranty"]) {
      const sh = p.env.ss.getSheetByName(json(p, `NV_SCHEMA.${key}.title`));
      const idx = json(p, `NV_SCHEMA.${key}.cols.map((c) => !!c.orderList)`).indexOf(true);
      const dv = sh._cell(6, 2 + idx).dv;
      expect(dv.range, key).toMatch(new RegExp(`:[A-Z]+${last}$`));
      expect(sh._cell(10, 2 + idx).dv).toBe(dv);
    }
  });
});

describe("group 3: column groups of the orders sheet stay separate groups", () => {
  it("adjacent columns of the same depth form one group: every group has an ungrouped column next to it", () => {
    const sh = built.env.ss.getSheetByName("Заказы");
    const groups = json(built, "Object.keys(NV_SCHEMA.orders.groups)");
    const n = sh.getMaxColumns();
    const runs = [];
    let from = null;
    for (let c = 1; c <= n + 1; c++) {
      const d = c <= n ? sh.getColumnGroupDepth(c) : 0;
      if (d > 0 && from === null) from = c;
      if (d === 0 && from !== null) {
        runs.push([from, c - 1]);
        from = null;
      }
    }
    expect(runs).toHaveLength(groups.length);
  });

  it("each grouped column is collapsed, the others are not grouped", () => {
    const sh = built.env.ss.getSheetByName("Заказы");
    const cols = json(built, "NV_SCHEMA.orders.cols.map((c) => c.grp || '')");
    cols.forEach((g, i) => {
      expect(sh.getColumnGroupDepth(2 + i) > 0, `${i}`).toBe(Boolean(g));
      if (g) expect(sh.collapsedCols.has(2 + i)).toBe(true);
    });
  });
});

describe("group 3: banding is not hidden behind a fill of the cells", () => {
  it("no cell inside a banded range has a fill of its own", () => {
    const bad = [];
    for (const sh of built.env.ss.sheets)
      for (const b of sh.bandings) {
        const r = b.range;
        for (let row = r.getRow(); row <= r.getLastRow(); row++)
          for (let col = r.getColumn(); col <= r.getLastColumn(); col++) {
            const cell = sh.cells.get(`${row},${col}`);
            if (cell?.bg) bad.push(`${sh.name}!${colLetterOf(col)}${row}`);
          }
      }
    expect(bad.slice(0, 8), `${bad.length} cells`).toEqual([]);
    expect(built.env.ss.sheets.flatMap((s) => s.bandings).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the formulas of the whole book against the documentation

function allFormulas(p) {
  const ss = p.env.ss;
  const out = [];
  const sheetOfName = (name) => ss.getRangeByName(name)?.getSheet().getName();
  const seen = new Set();
  for (const sh of ss.sheets) {
    const add = (where, at, f) => out.push({ where, sheet: sh.name, at: `${sh.name}!${at}`, f, sheetOfName });
    for (const [k, c] of sh.cells) {
      if (c.f) add("cell", k, c.f);
      if (c.dv && c.dv.type === "formula" && !seen.has(c.dv)) {
        seen.add(c.dv);
        add("validation", k, c.dv.formula);
      }
    }
    for (const r of sh.cf) add("format", r.ranges?.[0]?.getA1Notation?.() ?? "", r.formula);
  }
  return out;
}

function lintBook(p, rules) {
  const bad = [];
  for (const x of allFormulas(p)) {
    const found = lintFormula(x.f, {
      sheet: x.sheet,
      where: x.where,
      isOtherSheetName: (n) => {
        const s = x.sheetOfName(n);
        return s !== undefined && s !== x.sheet;
      },
    }).filter((q) => rules.includes(q.rule));
    for (const q of found) bad.push(`${x.at} [${x.where}] ${q.rule}: ${q.text}`);
  }
  return [...new Set(bad)];
}

describe("formulas of the book: the documentation of Google, rule by rule", () => {
  it("another sheet in data validation and conditional formatting only through INDIRECT", () => {
    expect(lintBook(built, ["other-sheet-name", "other-sheet-ref"])).toEqual([]);
  });

  it("INDIRECT takes an address, not the name of a range", () => {
    expect(lintBook(built, ["indirect-name"])).toEqual([]);
  });

  it("the linter itself finds what it is meant to find", () => {
    const rules = (f, ctx) => lintFormula(f, ctx).map((q) => q.rule);
    expect(rules('=INDIRECT("NV_CAC_LIMIT")')).toContain("indirect-name");
    expect(rules("=INDIRECT(\"'Настройки'!C12\")")).not.toContain("indirect-name");
    const ctx = { sheet: "Калькулятор", where: "validation", isOtherSheetName: () => true };
    expect(rules("=C1<=NV_MAX_BUDGET", ctx)).toContain("other-sheet-name");
    expect(rules("=C1<=INDIRECT(\"'Настройки'!C5\")", ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// group 4: charts and sparklines

describe("group 4: SPARKLINE options belong to the type of the sparkline", () => {
  it("every sparkline of the book uses only the options of its own type", () => {
    expect(lintBook(built, ["sparkline-option", "sparkline-type"])).toEqual([]);
  });

  it("the linter finds lastcolor on a line, and accepts it on a column", () => {
    const line = '=SPARKLINE(A1:A5,{"charttype","line";"lastcolor","red"})';
    const col = '=SPARKLINE(A1:A5,{"charttype","column";"lastcolor","red"})';
    expect(lintFormula(line).map((q) => q.rule)).toContain("sparkline-option");
    expect(lintFormula(col)).toEqual([]);
  });

  it("the tile «Резерв гарантии» (a line) marks the state by the colour of the line, the columns by the last bar", () => {
    const sh = built.env.ss.getSheetByName("Панель");
    const tiles = json(built, "NV_TILES.map((t, i) => ({ key: t.key, trend: t.trend, pos: nvTilePos(i) }))");
    const wres = tiles.find((t) => t.key === "wres");
    const f = sh._cell(wres.pos.row + 3, wres.pos.col).f;
    expect(f).toContain('"charttype","line"');
    expect(f).toMatch(/"color",IF\(\$[A-Z]+\d+=TRUE,/);
    expect(f).not.toContain("lastcolor");
    for (const t of tiles.filter((x) => x.trend?.type === "column"))
      expect(sh._cell(t.pos.row + 3, t.pos.col).f, t.key).toContain('"lastcolor"');
  });
});

describe("group 4: gridlines only on the continuous axis", () => {
  const charts = () => built.env.ss.getSheetByName("Панель").charts;
  const T = () => json(built, "nvThemeFor('panel')");

  it("a horizontal bar chart has gridlines on hAxis (values) and none on vAxis (categories)", () => {
    const bars = charts().filter((c) => c.spec.type === "BAR");
    expect(bars).toHaveLength(4);
    for (const c of bars) {
      const keys = Object.keys(c.spec.options);
      expect(keys.filter((k) => k.startsWith("vAxis.gridlines") || k.startsWith("vAxis.minorGridlines"))).toEqual([]);
      expect(c.spec.options["hAxis.gridlines.color"]).toBe(T().grid);
    }
  });

  it("the other charts have gridlines on vAxis and none on the discrete hAxis", () => {
    const others = charts().filter((c) => c.spec.type !== "BAR");
    expect(others).toHaveLength(4);
    for (const c of others) {
      const keys = Object.keys(c.spec.options);
      expect(keys.filter((k) => k.startsWith("hAxis.gridlines") || k.startsWith("hAxis.minorGridlines"))).toEqual([]);
      expect(c.spec.options["vAxis.gridlines.color"]).toBe(T().grid);
    }
  });

  it("the mock refuses gridlines on a discrete axis, an unknown option and a type that does not exist", () => {
    const sh = built.env.ss.getSheetByName("Панель");
    const data = built.env.ss.getSheetByName("_Данные");
    const base = () => sh.newChart().setChartType("BAR").addRange(data.getRange("A1:C5")).setPosition(2, 2, 0, 0);
    expect(() => base().setOption("vAxis.gridlines.color", "#eee").build()).toThrow(/continuous axis/);
    expect(() => base().setOption("hAxis.gridlines.color", "#eee").build()).not.toThrow();
    expect(() => base().setOption("titel", "x").build()).toThrow(/Unknown chart option/);
    expect(() => sh.newChart().setChartType("BARS")).toThrow(/setChartType/);
    expect(() =>
      sh
        .newChart()
        .setChartType("LINE")
        .addRange(data.getRange("A1:C5"))
        .setOption("hAxis.gridlines.color", "#eee")
        .build(),
    ).toThrow(/discrete/);
  });
});

describe("group 4: the script removes only its own charts", () => {
  const own = (p) => p.env.ss.getSheetByName("Панель").charts;

  function fresh() {
    const p = newProject();
    p.call("nvSetup");
    return p;
  }

  function ownersChart(p, row, col) {
    const sh = p.env.ss.getSheetByName("Панель");
    const data = p.env.ss.getSheetByName("_Данные");
    const chart = sh
      .newChart()
      .setChartType("COLUMN")
      .addRange(data.getRange("A1:B5"))
      .setPosition(row, col, 0, 0)
      .setOption("title", "Мой график")
      .build();
    sh.insertChart(chart);
    return chart;
  }

  it("a chart added by the owner survives the rebuild, and the eight of the script are not doubled", () => {
    const p = fresh();
    expect(own(p)).toHaveLength(8);
    const mine = ownersChart(p, 90, 2);
    p.call("nvBuildCharts");
    p.call("nvBuildCharts");
    expect(own(p)).toHaveLength(9);
    expect(own(p)).toContain(mine);
  });

  it("a chart of the script that the owner moved is still replaced, not left as a second copy", () => {
    const p = fresh();
    const moved = own(p)[0];
    moved.spec.position = { row: 100, col: 5, offX: 0, offY: 0 };
    p.call("nvBuildCharts");
    expect(own(p)).toHaveLength(8);
    expect(own(p)).not.toContain(moved);
  });

  it("the ids are kept in a document property", () => {
    const p = fresh();
    const ids = JSON.parse(p.env.docProps.get("NV_CHART_IDS"));
    expect(ids).toHaveLength(8);
    expect(ids.sort()).toEqual(
      own(p)
        .map((c) => c.getChartId())
        .sort(),
    );
  });
});

describe("group 4: setOption does not say whether a key was taken, the self-check reads it back", () => {
  const row = (p) => p.call("nvSelfCheckRows").find((r) => r.check === "Графики");

  it("all watched options come back: OK", () => {
    expect(row(built).result).toBe("ОК");
  });

  it("when Sheets keeps no stacking and no series settings the self-check names the charts and keys", () => {
    const p = newProject();
    p.call("nvSetup");
    p.env.chartDropOptions = ["isStacked", "series"];
    const r = row(p);
    expect(r.result).toBe("Предупреждение");
    expect(r.details).toContain("funnel: isStacked");
    expect(r.details).toContain("deals_vs_threshold: series");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// group 5: sheet functions in formulas

describe("group 5: HSTACK gets no bare scalar (it would pad the other rows with #N/A)", () => {
  it("no formula of the book has a scalar literal as an argument of HSTACK", () => {
    expect(lintBook(built, ["hstack-scalar"])).toEqual([]);
  });

  it("every block of «_Задачи» stretches its text, object, sum and code over the height of the key column", () => {
    const block = built.call("nvTaskBlock", {
      sheet: "orders",
      keyCol: "num",
      code: "order_x",
      due: built.call("nvR", "orders", "dEstimate"),
      text: '"Сделать"',
      object: "Заказ",
      num: built.call("nvR", "orders", "num"),
      client: built.call("nvR", "orders", "clientName"),
      amount: undefined,
      conds: ["TRUE"],
    });
    const key = built.call("nvR", "orders", "num");
    const stretched = block.split(`IF(ROW(${key});`).length - 1;
    expect(stretched).toBeGreaterThanOrEqual(4);
  });

  it("the linter finds a scalar in HSTACK and accepts a stretched one", () => {
    expect(lintFormula('=HSTACK(A1:A9,"x")').map((q) => q.rule)).toContain("hstack-scalar");
    expect(lintFormula('=HSTACK(A1:A9,IF(ROW(A1:A9),"x"))')).toEqual([]);
  });
});

describe("group 5: the tax of December is paid in January, and the flag can be set", () => {
  const evalAt = (iso, paidDec, paidMonths = {}) => {
    const p = newProject({ now: new Date(iso) });
    p.call("nvSetup");
    const th = p.env.ss.getSheetByName("Порог и налоги");
    th.getRange("O19").setValue(paidDec);
    for (const [row, v] of Object.entries(paidMonths)) th.getRange(`O${row}`).setValue(v);
    const comp = createComputer(p);
    const f = p.call("nvPrevTaxPaidFormula");
    return calc(f, comp.ctxFor("Порог и налоги"));
  };

  it("the cell of December has a name and a checkbox", () => {
    expect(built.env.ss.getRangeByName("TH_PAID_DEC")).toBeTruthy();
    const sh = built.env.ss.getSheetByName("Порог и налоги");
    expect(sh._cell(19, 15).dv.type).toBe("checkbox");
  });

  it("in January the flag of December counts (before: the month was not in the table, the reminder could not be cleared)", () => {
    expect(evalAt("2027-01-12T10:00:00+05:00", false)).toBe(false);
    expect(evalAt("2027-01-12T10:00:00+05:00", true)).toBe(true);
  });

  it("in the other months the flag of the previous month in the table counts", () => {
    // October 2026: the previous month is September, row 14 of the table (E6 is January)
    expect(evalAt("2026-10-07T10:00:00+05:00", false, { 14: false })).toBe(false);
    expect(evalAt("2026-10-07T10:00:00+05:00", false, { 14: true })).toBe(true);
  });

  it("both the tile and the list of tasks use that one formula", () => {
    const today = built.call("nvTaxTasksFormula");
    expect(today).toContain("TH_PAID_DEC");
    const kpi = JSON.stringify(built.call("nvKpiDefs"));
    expect(kpi).toContain("TH_PAID_DEC");
  });

  it("the cells of December are open for the owner", () => {
    const sh = built.env.ss.getSheetByName("Порог и налоги");
    const open = sh.sheetProtection.unprotected.map((r) => r.getA1Notation());
    expect(open.some((a) => a.includes("O19"))).toBe(true);
  });
});

describe("group 5: links go through an address the reference allows", () => {
  it("no link of the book starts with #gid=", () => {
    expect(lintBook(built, ["hyperlink-anchor"])).toEqual([]);
  });

  it("the link of a task is the address of the book with #gid= and the row", () => {
    const f = built.env.ss.getSheetByName("_Задачи")._cell(2, 1).f;
    expect(f).toContain('"https://docs.google.com/spreadsheets/d/mock-spreadsheet-id/edit#gid=');
    expect(f).toMatch(/#gid=\d+&range=B"&ROW\(/);
  });

  it("the linter finds an anchor link", () => {
    expect(lintFormula('=HYPERLINK("#gid=5","x")').map((q) => q.rule)).toContain("hyperlink-anchor");
    expect(lintFormula('=HYPERLINK("https://a.b/#gid=5","x")')).toEqual([]);
  });
});

describe("group 5: names in LAMBDA and LET are not references", () => {
  it("no LAMBDA or LET name of the book is r, c, rc, r1c1 or like A1", () => {
    expect(lintBook(built, ["risky-name"])).toEqual([]);
  });

  it("the linter finds the names it must", () => {
    for (const n of ["c", "r", "rc", "r1c2", "A1", "ab12"])
      expect(
        lintFormula(`=MAP(A1:A3,LAMBDA(${n},${n}*2))`).map((q) => q.rule),
        n,
      ).toContain("risky-name");
    for (const n of ["code_", "num_", "d", "key_"])
      expect(lintFormula(`=MAP(A1:A3,LAMBDA(${n},${n}*2))`), n).toEqual([]);
    expect(lintFormula("=LET(c,1,c+1)").map((q) => q.rule)).toContain("risky-name");
  });
});

describe("group 5: COUNTIFS and the like take ranges, not computed arrays", () => {
  it("no *IFS function of the book gets an array from FILTER or from a LET variable", () => {
    expect(lintBook(built, ["ifs-array"])).toEqual([]);
  });

  it("the list «Сегодня» counts rows of the sorted array by arithmetic", () => {
    const f = built.env.ss.getSheetByName("Сегодня")._cell(6, 2).f;
    expect(f).not.toMatch(/COUNTIFS\(/);
    expect(f).toContain('SUMPRODUCT((INDEX(t,,4)=num_)*(INDEX(t,,7)<>"next_step"))=0');
  });

  it("the stages on «_Данные» match the codes by MATCH, not by COUNTIFS over an array of criteria", () => {
    const data = built.env.ss.getSheetByName("_Данные");
    const stages = json(built, "NV_ND.stages");
    const d = data._cell(stages, 4).f;
    const c = data._cell(stages, 3).f;
    for (const f of [d, c]) {
      expect(f).toContain("ISNUMBER(MATCH(");
      expect(f).not.toContain("COUNTIFS(");
    }
    expect(c).toContain("TODAY()");
  });

  it("the linter finds the two shapes", () => {
    const rules = (f) => lintFormula(f).map((q) => q.rule);
    expect(rules("=LET(t,SORT(A1:B9),COUNTIFS(INDEX(t,,1),5))")).toContain("ifs-array");
    expect(rules("=SUMPRODUCT(COUNTIFS(A1:A9,FILTER(B1:B9,B1:B9>1)))")).toContain("ifs-array");
    expect(rules('=COUNTIFS(A1:A9,B1,C1:C9,"x")')).toEqual([]);
  });
});

describe("group 5: XLOOKUP takes one key", () => {
  it("no XLOOKUP of the book gets a range as the key", () => {
    expect(lintBook(built, ["xlookup-array"])).toEqual([]);
  });

  it("the linter finds a range as a key and accepts a variable", () => {
    expect(lintFormula("=XLOOKUP(A1:A9,B1:B9,C1:C9)").map((q) => q.rule)).toContain("xlookup-array");
    expect(lintFormula("=XLOOKUP('Закупки'!$G$6:$G,B1:B9,C1:C9)").map((q) => q.rule)).toContain("xlookup-array");
    expect(lintFormula("=MAP(A1:A9,LAMBDA(k_,XLOOKUP(k_,B1:B9,C1:C9)))")).toEqual([]);
  });
});
