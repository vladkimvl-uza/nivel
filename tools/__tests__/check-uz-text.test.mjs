import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkUzMessages, checkUzString, suggest } from "../check-uz-text.mjs";
import { ROOT } from "../lib/env.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "nivel-check-uz-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

const uz = (name, data) => ({ [`packages/i18n/messages/uz/${name}.json`]: data });

describe("check-uz-text", () => {
  it("catches o'zbek with U+0027", () => {
    const problems = checkUzString("uz/common.json lang.uz", "o'zbek tili");
    expect(problems).toEqual(['uz/common.json lang.uz: "o\'zbek" has U+0027 inside a word; use "oʻzbek"']);
  });

  it("catches U+2019 and suggests U+02BC after other letters", () => {
    expect(checkUzString("k", "ma’lumot")).toHaveLength(1);
    expect(suggest("ma’lumot")).toBe("maʼlumot");
    expect(suggest("g'isht")).toBe("gʻisht");
  });

  it("accepts correct Uzbek letters", () => {
    expect(checkUzString("k", "Oʻzbekcha, yigʻib, maʼlumot")).toEqual([]);
  });

  it("catches the wrong mark after o/g and after other letters", () => {
    expect(checkUzString("k", "oʼzbek")).toHaveLength(1);
    expect(checkUzString("k", "maʻlumot")).toHaveLength(1);
  });

  it("scans nested message files and names the file and key", () => {
    const root = makeRoot(uz("site", { hero: { title: "Oʻzbek", lead: "yig'ib" } }));
    expect(checkUzMessages(root)).toEqual(['uz/site.json hero.lead: "yig\'ib" has U+0027 inside a word; use "yigʻib"']);
  });

  it("scans every namespace file", () => {
    const root = makeRoot({ ...uz("a", { k: "o'z" }), ...uz("b", { k: "g'z" }) });
    expect(checkUzMessages(root)).toHaveLength(2);
  });

  it("ignores Russian files and non-JSON files", () => {
    const root = makeRoot({
      "packages/i18n/messages/ru/site.json": { k: "o'zbek" },
      "packages/i18n/messages/uz/readme.txt": "o'z",
    });
    expect(checkUzMessages(root)).toEqual([]);
  });

  it("returns nothing when there is no uz folder", () => {
    expect(checkUzMessages(makeRoot({}))).toEqual([]);
  });

  it("also checks the Uzbek terms of the glossary seed", () => {
    const root = makeRoot({
      "packages/db/seed/glossary/glossary.json": [
        { no: 1, termRu: "а", termUz: "o'yin", termUzNewLatin: null, note: null },
      ],
    });
    expect(checkUzMessages(root)).toEqual(['glossary #1 termUz: "o\'yin" has U+0027 inside a word; use "oʻyin"']);
  });

  it("passes for the real repository", () => {
    expect(checkUzMessages(ROOT)).toEqual([]);
  });

  describe("command line", () => {
    const run = (...args) =>
      spawnSync(process.execPath, [join(ROOT, "tools", "check-uz-text.mjs"), ...args], { encoding: "utf8" });

    it("exits 1 with the problem list, 0 when clean", () => {
      const bad = run("--root", makeRoot(uz("site", { k: "o'zbek" })));
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("check-uz-text: 1 problem(s)");
      const ok = run("--root", makeRoot(uz("site", { k: "Oʻzbek" })));
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("check-uz-text: Uzbek apostrophes OK");
    });

    it("works on the repository without arguments (the CI step)", () => {
      expect(run().status).toBe(0);
    });
  });
});
