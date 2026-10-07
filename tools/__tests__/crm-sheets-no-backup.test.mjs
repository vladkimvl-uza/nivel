// The decision of the owner of 07.10.2026: "копии не нужны". The weekly copy of the book on the Google Drive is gone as a
// whole: the function, its trigger, its two settings and the scope of the full access to the Drive. A book that an
// earlier version built is brought to the same state by the next run of the setup and of "Установить триггеры".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBundle, DIST_DIR } from "../crm-sheets/scripts/bundle.mjs";
import { createProject } from "../crm-sheets/scripts/env.mjs";
import { createGas } from "../crm-sheets/scripts/gas-mock.mjs";
import { SRC_DIR, sourceFiles } from "../crm-sheets/scripts/load.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
const read = (dir, name) => readFileSync(join(dir, name), "utf8");
const FOUR = ["nvDailyDigest", "nvHourlyJob", "nvMonthlyJob", "nvOnEdit"];

describe("no copy to the Drive: the code", () => {
  const sources = sourceFiles().map((f) => [f, read(SRC_DIR, f)]);

  it("neither the sources, nor the bundle, nor the file of dist name the Drive, the function of the copy or its settings", () => {
    const texts = [...sources.map(([, t]) => t), buildBundle(), read(DIST_DIR, "Nivel-CRM.gs")];
    for (const t of texts) {
      expect(t).not.toMatch(/\bDriveApp\b/);
      expect(t).not.toContain("nvWeeklyBackup");
      expect(t).not.toMatch(/backupOn|backupKeep/);
    }
  });

  it("the old names of the two settings stay in one place only: the list of the retired settings of the settings sheet", () => {
    const hits = sources.filter(([, t]) => t.includes("NV_BACKUP")).map(([f]) => f);
    expect(hits).toEqual(["09_settings_sheet.js"]);
  });

  it("the function of the copy is not defined, and the mock of Google has no DriveApp: a call to the Drive stops a test", () => {
    const p = createProject({ now: T0 });
    expect(p.run("typeof nvWeeklyBackup")).toBe("undefined");
    expect(p.run("typeof DriveApp")).toBe("undefined");
  });
});

describe("no copy to the Drive: the manifest", () => {
  for (const [place, dir] of [
    ["src", SRC_DIR],
    ["dist", DIST_DIR],
  ]) {
    it(`${place}/appsscript.json asks for no scope of the Drive (neither drive nor drive.file) and enables no service of it`, () => {
      const manifest = JSON.parse(read(dir, "appsscript.json"));
      expect(manifest.oauthScopes.filter((s) => /auth\/drive/.test(s))).toEqual([]);
      expect(manifest.dependencies.enabledAdvancedServices.map((s) => s.serviceId)).toEqual(["sheets"]);
    });
  }
});

describe("no copy to the Drive: the triggers and the settings of a built book", () => {
  let p;
  /** What the version of 06.10.2026 installed for the copy: every Sunday from 3 to 4 (the mock does not check the function). */
  const oldCopyTrigger = () =>
    p.run(
      `ScriptApp.newTrigger("nvWeeklyBackup").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone("Asia/Tashkent").create()`,
    );
  const handlers = () => p.env.triggers.map((t) => t.handler).sort();

  beforeAll(() => {
    p = createProject({ now: T0 });
    p.call("nvSetup");
  }, 60_000);

  it("installs four triggers: edit, hourly, daily, monthly; nothing by the day of the week", () => {
    p.env.triggers = [];
    const r = p.call("nvInstallTriggers");
    expect(handlers()).toEqual(FOUR);
    expect(p.env.triggers.some((t) => t.params.weekDay)).toBe(false);
    expect(r.installed).toHaveLength(4);
    expect(r.installed.join(" | ")).not.toMatch(/копи/i);
    expect(r.removed).toEqual([]);
    expect(JSON.parse(JSON.stringify(p.call("nvTriggerCounts")))).toEqual({
      nvOnEdit: 1,
      nvHourlyJob: 1,
      nvDailyDigest: 1,
      nvMonthlyJob: 1,
    });
  });

  it("an install over a book where the trigger of the copy exists takes it out, and touches nothing else", () => {
    p.env.triggers = [];
    p.call("nvInstallTriggers");
    oldCopyTrigger();
    p.run('ScriptApp.newTrigger("myOwnFunction").timeBased().everyDays(1).create()'); // another function of the owner
    p.run('ScriptApp.newTrigger("nvSetupContinue").timeBased().after(60000).create()'); // ours, and the function exists
    expect(p.env.triggers).toHaveLength(7);
    const r = p.call("nvInstallTriggers");
    expect(r.removed).toEqual(["nvWeeklyBackup"]);
    expect(handlers()).toEqual(["myOwnFunction", ...FOUR, "nvSetupContinue"].sort());
    // the second install has nothing left to take out
    expect(p.call("nvInstallTriggers").removed).toEqual([]);
    expect(handlers()).toEqual(["myOwnFunction", ...FOUR, "nvSetupContinue"].sort());
  });

  it("from the menu the owner is told which trigger was taken out", () => {
    p.env.triggers = [];
    oldCopyTrigger();
    p.call("nvMenuInstallTriggers");
    const msg = p.env.ss.toasts.at(-1).msg;
    expect(msg).toContain("Триггеры установлены");
    expect(msg).toContain("nvWeeklyBackup");
    expect(handlers()).toEqual(FOUR);
  });

  it("the self-check names a trigger of a function that is gone, until the install takes it out", () => {
    p.env.triggers = [];
    p.call("nvInstallTriggers");
    const rows = () => p.call("nvSelfCheckRows");
    expect(rows().map((r) => r.check)).not.toContain("Лишние триггеры");
    oldCopyTrigger();
    const row = rows().find((r) => r.check === "Лишние триггеры");
    expect(row.result).toBe("Предупреждение");
    expect(row.details).toContain("nvWeeklyBackup");
    expect(row.details).toContain("Установить триггеры");
    // the set of four is complete, so the row of the triggers stays green
    expect(rows().find((r) => r.check === "Триггеры").result).toBe("ОК");
    p.call("nvInstallTriggers");
    expect(rows().map((r) => r.check)).not.toContain("Лишние триггеры");
  });

  it("a new book has no row, no name and no value of the copy among its settings", () => {
    const names = JSON.parse(p.run("JSON.stringify(nvSettingRows().map((r) => r.name))"));
    expect(names.filter((n) => /BACKUP/.test(n))).toEqual([]);
    const keys = JSON.parse(p.run("JSON.stringify(Object.keys(nvSettings(true)))"));
    expect(keys.filter((k) => /backup/i.test(k))).toEqual([]);
    const sheet = p.env.ss.getSheetByName("Настройки");
    const column = sheet
      .getRange(6, 2, sheet.getMaxRows() - 5, 5)
      .getValues()
      .flat();
    expect(column.filter((v) => /BACKUP|копи/i.test(String(v)))).toEqual([]);
    expect(p.env.ss.getRangeByName("NV_BACKUP_ON")).toBeNull();
  });
});

describe("no copy to the Drive: a book that an earlier version built", () => {
  /** The two rows that the setup of 06.10.2026 wrote after «Канал сводки» (columns B..F), as it wrote them. */
  const RETIRED = [
    ["Еженедельная копия книги на Drive", true, "", "NV_BACKUP_ON", "решение владельца"],
    ["Копий хранить", 8, "шт.", "NV_BACKUP_KEEP", "решение владельца"],
  ];
  const build = () => {
    const p = createProject({ now: T0 });
    p.call("nvSetup");
    return p;
  };
  const layoutOf = (p) => JSON.parse(p.run("JSON.stringify(nvSettingsLayout())"));
  /** Label, value, unit, name and source of every row of the settings (the date of the change is the date of the run). */
  const block = (p) => {
    const sheet = p.env.ss.getSheetByName("Настройки");
    return JSON.parse(JSON.stringify(sheet.getRange(6, 2, layoutOf(p).length, 5).getValues()));
  };

  /** Turns a book of this version into a book as the earlier one left it: two more rows, everything below moved down. */
  function asTheEarlierVersionBuiltIt(p) {
    const ss = p.env.ss;
    const sheet = ss.getSheetByName("Настройки");
    const layout = layoutOf(p);
    const after = layout.find((x) => x.def.name === "NV_DIGEST_CHANNEL").row;
    sheet.insertRowsAfter(sheet.getMaxRows(), 2);
    for (const x of layout.filter((y) => y.row > after).reverse()) {
      // the format goes first: a text cell ("@") keeps "1" as text, any other format reads it as the number 1
      sheet.getRange(x.row + 2, 3).setNumberFormat(sheet.getRange(x.row, 3).getNumberFormat());
      sheet.getRange(x.row + 2, 2, 1, 6).setValues(sheet.getRange(x.row, 2, 1, 6).getValues());
      const formula = sheet.getRange(x.row, 3).getFormula();
      if (formula) sheet.getRange(x.row + 2, 3).setFormula(formula);
      if (x.def.name) ss.setNamedRange(x.def.name, sheet.getRange(x.row + 2, 3));
    }
    RETIRED.forEach((r, i) => {
      sheet.getRange(after + 1 + i, 2, 1, 5).setValues([r]);
      sheet.getRange(after + 1 + i, 7).setValue(sheet.getRange(after, 7).getValue());
      ss.setNamedRange(r[3], sheet.getRange(after + 1 + i, 3));
    });
    return after;
  }

  it("the next setup takes the two rows out, and every setting stands again on its row under its own name", () => {
    const fresh = build();
    const old = build();
    const after = asTheEarlierVersionBuiltIt(old);
    const layout = layoutOf(old);
    const ss = old.env.ss;
    const sheet = ss.getSheetByName("Настройки");
    // the premise: the book looks as the earlier version made it
    expect(ss.getRangeByName("NV_BACKUP_ON").getRow()).toBe(after + 1);
    expect(ss.getRangeByName("NV_BACKUP_KEEP").getRow()).toBe(after + 2);
    expect(ss.getRangeByName("NV_WEBHOOK_ON").getRow()).toBe(
      layout.find((x) => x.def.name === "NV_WEBHOOK_ON").row + 2,
    );
    // the owner has changed a setting that stood below the two rows
    ss.getRangeByName("NV_HMAC_SKEW_SEC").setValue(123);

    old.call("nvSetup");

    expect(ss.getRangeByName("NV_BACKUP_ON")).toBeNull();
    expect(ss.getRangeByName("NV_BACKUP_KEEP")).toBeNull();
    expect(
      sheet
        .getRange(6, 5, sheet.getMaxRows() - 5, 1)
        .getValues()
        .flat()
        .filter((v) => /BACKUP/.test(String(v))),
    ).toEqual([]);
    for (const x of layout.filter((y) => y.def.name)) {
      expect(ss.getRangeByName(x.def.name).getRow(), x.def.name).toBe(x.row);
      expect(sheet.getRange(x.row, 5).getValue(), x.def.name).toBe(x.def.name);
    }
    // the sheet is the sheet of a new book, but for the value that the owner changed
    const expected = block(fresh);
    expected[layout.findIndex((x) => x.def.name === "NV_HMAC_SKEW_SEC")][1] = 123;
    expect(block(old)).toEqual(expected);
    expect(sheet.getMaxRows()).toBe(fresh.env.ss.getSheetByName("Настройки").getMaxRows());
    expect(old.call("nvSettings", true).hmacSkewSec).toBe(123);
    expect(old.call("nvSelfCheckRows").find((r) => r.check === "Именованные диапазоны").result).toBe("ОК");

    // a third run finds nothing more to take out
    old.call("nvSetup");
    expect(block(old)).toEqual(expected);
  });

  it("a book that never had the rows is not touched by the migration (no row is deleted)", () => {
    const p = build();
    const before = block(p);
    const rows = p.env.ss.getSheetByName("Настройки").getMaxRows();
    p.env.ss.getRangeByName("NV_HMAC_SKEW_SEC").setValue(77);
    p.call("nvSetup");
    const after = block(p);
    before[layoutOf(p).findIndex((x) => x.def.name === "NV_HMAC_SKEW_SEC")][1] = 77;
    expect(after).toEqual(before);
    expect(p.env.ss.getSheetByName("Настройки").getMaxRows()).toBe(rows);
  });
});

describe("the mock deletes rows as Sheets does (the migration of the settings relies on it)", () => {
  const sheetWithRows = () => {
    const { env } = createGas({ now: T0 });
    const sh = env.ss.insertSheet("T");
    for (let r = 1; r <= 10; r++) sh.getRange(r, 1).setValue(`r${r}`);
    return { ss: env.ss, sh };
  };

  it("moves the rows below up with their values, formulas and formats, and leaves the rows above", () => {
    const { sh } = sheetWithRows();
    sh.getRange(8, 2).setFormula("=A8");
    sh.getRange(9, 1).setNumberFormat("@");
    sh.deleteRows(4, 2);
    expect(sh.getRange(3, 1).getValue()).toBe("r3");
    expect(sh.getRange(4, 1).getValue()).toBe("r6");
    expect(sh.getRange(8, 1).getValue()).toBe("r10");
    expect(sh.getRange(9, 1).getValue()).toBe("");
    expect(sh.getRange(6, 2).getFormula()).toBe("=A8");
    expect(sh.getRange(7, 1).getNumberFormat()).toBe("@");
    expect(sh.getMaxRows()).toBe(998);
  });

  it("moves the named ranges with their cells, drops the name of cells that were deleted, and shrinks a range that spans them", () => {
    const { ss, sh } = sheetWithRows();
    const held = sh.getRange(8, 1);
    ss.setNamedRange("ABOVE", sh.getRange(2, 1));
    ss.setNamedRange("BELOW", held);
    ss.setNamedRange("INSIDE", sh.getRange(4, 1, 2, 1));
    ss.setNamedRange("SPAN", sh.getRange(3, 1, 5, 1));
    ss.setNamedRange("ELSEWHERE", ss.getSheets()[0].getRange(8, 1));
    sh.deleteRows(4, 2);
    expect(ss.getRangeByName("ABOVE").getRow()).toBe(2);
    expect(ss.getRangeByName("BELOW").getRow()).toBe(6);
    expect(ss.getRangeByName("INSIDE")).toBeNull();
    expect(ss.getRangeByName("SPAN").getA1Notation()).toBe("A3:A5");
    expect(ss.getRangeByName("ELSEWHERE").getRow()).toBe(8);
    // a range that the code holds in a variable keeps the coordinates it had
    expect(held.getRow()).toBe(8);
  });

  it("refuses what Sheets refuses: rows outside the grid, all the rows of the sheet, a bad argument", () => {
    const { sh } = sheetWithRows();
    expect(() => sh.deleteRows(999, 5)).toThrow(/out of bounds/);
    expect(() => sh.deleteRows(1, 1000)).toThrow(/all the rows/);
    expect(() => sh.deleteRows(0, 1)).toThrow(/signature/);
    expect(() => sh.deleteRows(1, 1.5)).toThrow(/signature/);
  });
});
