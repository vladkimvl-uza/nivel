// Check of the CRM against the documentation of Google (round 3). Every finding of the check has a test here that failed
// before the fix. The mock of Apps Script and of the Sheets service refuses what Google refuses (see gas-mock.mjs):
// the types of arguments, methods and enum values that do not exist, options a method does not support.
import { readFileSync } from "node:fs";
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
