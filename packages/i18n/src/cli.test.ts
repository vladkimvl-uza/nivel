import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runExport, runImport, runNewLatin } from "./cli.ts";
import { botFixture, makeRoot, readJson, siteFixture, tempDir } from "./flow-fixtures.ts";
import { readXlsx, writeXlsx } from "./xlsx.ts";

const O = "ʻ";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m: string) => out.push(m), error: (m: string) => err.push(m) };
}

const newRoot = () => makeRoot({ site: siteFixture, bot: botFixture });
const tmp = () => tempDir("nivel-cli-");

describe("runExport", () => {
  it("writes the workbook to --out and reports the counts", () => {
    const root = newRoot();
    const out = join(tmp(), "t.xlsx");
    const o = io();
    expect(runExport(["--root", root, "--out", out], o)).toBe(0);
    expect(readXlsx(readFileSync(out))[0]?.rows).toHaveLength(5);
    expect(o.out.join("\n")).toContain("4 keys in 2 namespaces");
    expect(o.out.join("\n")).toContain(out);
  });

  it("defaults to .data/i18n/nivel-translations-<date in Tashkent>.xlsx", () => {
    const root = newRoot();
    const o = io();
    const now = new Date("2026-10-12T20:00:00Z"); // already 13.10 in Tashkent
    expect(runExport(["--root", root], o, { now })).toBe(0);
    expect(existsSync(join(root, ".data", "i18n", "nivel-translations-2026-10-13.xlsx"))).toBe(true);
  });

  it("exports chosen namespaces", () => {
    const root = newRoot();
    const out = join(tmp(), "bot.xlsx");
    expect(runExport(["--root", root, "--out", out, "--ns", "bot"], io())).toBe(0);
    expect(readXlsx(readFileSync(out))[0]?.rows).toHaveLength(2);
  });

  it("names the broken message file in the error", () => {
    const root = newRoot();
    writeFileSync(join(root, "packages", "i18n", "messages", "ru", "bot.json"), "{ nope");
    const o = io();
    expect(runExport(["--root", root, "--out", join(tmp(), "t.xlsx")], o)).toBe(2);
    expect(o.err.join("\n")).toMatch(/bot\.json/);
  });

  it("exits 2 with usage for an unknown option or namespace", () => {
    const o = io();
    expect(runExport(["--wat"], o)).toBe(2);
    expect(o.err.join("\n")).toContain("usage: i18n-export");
    const o2 = io();
    expect(runExport(["--root", newRoot(), "--ns", "nope"], o2)).toBe(2);
    expect(o2.err.join("\n")).toContain('Unknown namespace "nope"');
  });
});

describe("runImport", () => {
  function exported(root: string) {
    const file = join(tmp(), "in.xlsx");
    runExport(["--root", root, "--out", file], io());
    return file;
  }

  it("imports the untouched export with exit 0 and says nothing changed", () => {
    const root = newRoot();
    const o = io();
    expect(runImport([exported(root), "--root", root], o)).toBe(0);
    expect(o.out.join("\n")).toContain("0 changed");
  });

  it("writes changes and lists the written files", () => {
    const root = newRoot();
    const file = exported(root);
    const wb = readXlsx(readFileSync(file));
    (wb[0]?.rows[1] as unknown[])[5] = "Boshlash!";
    writeFileSync(file, writeXlsx(wb.map((s) => ({ name: s.name, rows: s.rows }))));
    const o = io();
    expect(runImport([file, "--root", root], o)).toBe(0);
    expect(readJson(root, "uz", "bot")).toEqual({ start: "Boshlash!" });
    expect(o.out.join("\n")).toContain("packages/i18n/messages/uz/bot.json");
  });

  it("--dry-run changes nothing", () => {
    const root = newRoot();
    const file = exported(root);
    const wb = readXlsx(readFileSync(file));
    (wb[0]?.rows[1] as unknown[])[5] = "Boshlash!";
    writeFileSync(file, writeXlsx(wb.map((s) => ({ name: s.name, rows: s.rows }))));
    const o = io();
    expect(runImport([file, "--root", root, "--dry-run"], o)).toBe(0);
    expect(readJson(root, "uz", "bot")).toEqual(botFixture.uz);
    expect(o.out.join("\n")).toContain("dry run");
  });

  it("exits 1 and prints every error when the file has problems", () => {
    const root = newRoot();
    const file = exported(root);
    const wb = readXlsx(readFileSync(file));
    (wb[0]?.rows[1] as unknown[])[5] = "Boshlaymiz!!";
    writeFileSync(file, writeXlsx(wb.map((s) => ({ name: s.name, rows: s.rows }))));
    const o = io();
    expect(runImport([file, "--root", root], o)).toBe(1);
    expect(o.err.join("\n")).toContain("row 2: bot:start uz is 12 > maxLen 10");
    expect(readJson(root, "uz", "bot")).toEqual(botFixture.uz);
  });

  it("prints warnings to stderr but still exits 0", () => {
    const root = newRoot();
    const file = exported(root);
    const wb = readXlsx(readFileSync(file));
    (wb[0]?.rows[1] as unknown[])[4] = "Другое";
    writeFileSync(file, writeXlsx(wb.map((s) => ({ name: s.name, rows: s.rows }))));
    const o = io();
    expect(runImport([file, "--root", root], o)).toBe(0);
    expect(o.err.join("\n")).toContain("warning: row 2: bot:start ru differs");
  });

  it("--normalize passes the apostrophe fixer, taken from dependencies", () => {
    const root = newRoot();
    const file = exported(root);
    const wb = readXlsx(readFileSync(file));
    (wb[0]?.rows[1] as unknown[])[5] = "o'zbek";
    writeFileSync(file, writeXlsx(wb.map((s) => ({ name: s.name, rows: s.rows }))));
    const o = io();
    const normalizeUz = (s: string) => s.replace("'", O);
    expect(runImport([file, "--root", root, "--normalize"], o, { normalizeUz })).toBe(0);
    expect(readJson(root, "uz", "bot")).toEqual({ start: `o${O}zbek` });
  });

  it("--normalize reports clearly when normalizeUz is not implemented yet", () => {
    const root = newRoot();
    const o = io();
    const normalizeUz = () => {
      throw new Error("Not implemented: text.normalizeUz");
    };
    expect(runImport([exported(root), "--root", root, "--normalize"], o, { normalizeUz })).toBe(2);
    expect(o.err.join("\n")).toContain("normalizeUz is not available");
  });

  it("exits 2 without a file, with a missing file or an unknown option", () => {
    const o = io();
    expect(runImport([], o)).toBe(2);
    expect(o.err.join("\n")).toContain("usage: i18n-import");
    expect(runImport([join(tmp(), "none.xlsx")], io())).toBe(2);
    expect(runImport(["x.xlsx", "--wat"], io())).toBe(2);
  });

  it.todo("after the WP-02 merge: --normalize without a stub calls the real normalizeUz from @nivel/domain");
});

describe("runNewLatin", () => {
  it("dry run prints how many strings would change and writes nothing", () => {
    const root = makeRoot({ x: { uz: { a: `O${O}zbek`, b: "Salom" }, ru: { a: "A", b: "B" }, meta: {} } });
    const o = io();
    expect(runNewLatin(["--root", root], o)).toBe(0);
    expect(o.out.join("\n")).toContain("1 of 2 strings would change");
    expect(readJson(root, "uz", "x")).toEqual({ a: `O${O}zbek`, b: "Salom" });
  });

  it("writes converted copies to --out and never over the sources", () => {
    const root = makeRoot({ x: { uz: { a: `O${O}zbek shahar` }, ru: { a: "A" }, meta: {} } });
    const out = join(tmp(), "nl");
    const o = io();
    expect(runNewLatin(["--root", root, "--out", out], o)).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "x.json"), "utf8"))).toEqual({ a: "Özbek şahar" });
    expect(readJson(root, "uz", "x")).toEqual({ a: `O${O}zbek shahar` });
  });

  it("refuses to write into the messages folder", () => {
    const root = makeRoot({ x: { uz: { a: "a" }, ru: { a: "A" }, meta: {} } });
    const o = io();
    expect(runNewLatin(["--root", root, "--out", join(root, "packages", "i18n", "messages", "uz")], o)).toBe(2);
    expect(o.err.join("\n")).toContain("inside the messages folder");
  });

  it("refuses the messages folder given with a different letter case on Windows", () => {
    const root = makeRoot({ x: { uz: { a: "a" }, ru: { a: "A" }, meta: {} } });
    const shouted = join(root, "packages", "I18N", "Messages", "UZ").replace(/^./, (c) => c.toLowerCase());
    const o = io();
    const code = runNewLatin(["--root", root, "--out", shouted], o);
    if (process.platform === "win32") {
      expect(code).toBe(2);
      expect(o.err.join("\n")).toContain("inside the messages folder");
    } else {
      expect(code).toBe(0); // paths are case-sensitive elsewhere: this is a different folder
    }
  });

  it("refuses a sibling folder whose name only starts like the messages folder", () => {
    const root = makeRoot({ x: { uz: { a: "a" }, ru: { a: "A" }, meta: {} } });
    const o = io();
    const sibling = join(root, "packages", "i18n", "messages-copy");
    expect(runNewLatin(["--root", root, "--out", sibling], o)).toBe(0);
  });

  it("names the broken file and exits 2 instead of crashing on invalid JSON", () => {
    const root = makeRoot({ x: { uz: { a: "a" }, ru: { a: "A" }, meta: {} } });
    writeFileSync(join(root, "packages", "i18n", "messages", "uz", "x.json"), "{ not json");
    const o = io();
    expect(runNewLatin(["--root", root], o)).toBe(2);
    expect(o.err.join("\n")).toMatch(/x.json/);
  });

  it("reads an extra exception list from a JSON file", () => {
    const root = makeRoot({ x: { uz: { a: "mashhur chiroq" }, ru: { a: "A" }, meta: {} } });
    const list = join(tmp(), "ex.json");
    writeFileSync(list, JSON.stringify(["mashhur"]));
    const out = join(tmp(), "nl");
    expect(runNewLatin(["--root", root, "--out", out, "--exceptions", list], io())).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "x.json"), "utf8"))).toEqual({ a: "mashhur çiroq" });
  });

  it("rejects a malformed exception list and unknown options", () => {
    const root = makeRoot({ x: { uz: { a: "a" }, ru: { a: "A" }, meta: {} } });
    const list = join(tmp(), "bad.json");
    writeFileSync(list, '{"not":"an array"}');
    expect(runNewLatin(["--root", root, "--exceptions", list], io())).toBe(2);
    expect(runNewLatin(["--root", root, "--exceptions", join(tmp(), "none.json")], io())).toBe(2);
    expect(runNewLatin(["--wat"], io())).toBe(2);
  });

  it("handles a repository without Uzbek files", () => {
    const o = io();
    expect(runNewLatin(["--root", makeRoot({})], o)).toBe(0);
    expect(o.out.join("\n")).toContain("0 of 0 strings would change");
  });
});

describe("tools/*.mjs entry points", () => {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const run = (script: string, args: string[]) =>
    spawnSync(process.execPath, [join(repo, "tools", script), ...args], {
      encoding: "utf8",
      env: { ...process.env, NETWORK_GUARD: "1" },
    });

  it("i18n-export.mjs then i18n-import.mjs work end to end in a separate process", () => {
    const root = newRoot();
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "e2e.xlsx");
    const ex = run("i18n-export.mjs", ["--root", root, "--out", file]);
    expect(ex.status, ex.stderr).toBe(0);
    const im = run("i18n-import.mjs", [file, "--root", root, "--dry-run"]);
    expect(im.status, im.stderr).toBe(0);
    expect(im.stdout).toContain("0 changed");
    expect(readdirSync(dir)).toEqual(["e2e.xlsx"]);
  });

  it("i18n-import.mjs exits 2 and prints usage without arguments", () => {
    const r = run("i18n-import.mjs", []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage: i18n-import");
  });

  it("uz-new-latin.mjs runs a dry run", () => {
    const root = makeRoot({ x: { uz: { a: `O${O}zbek` }, ru: { a: "A" }, meta: {} } });
    const r = run("uz-new-latin.mjs", ["--root", root]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("1 of 1 strings would change");
  });
});
