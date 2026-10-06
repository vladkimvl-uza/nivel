import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkMessages, checkNamespace, placeholders } from "../check-messages.mjs";
import { ROOT } from "../lib/env.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "nivel-check-messages-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, "packages", "i18n", "messages", rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

const meta = { context: "c", maxLen: 30, status: "draft" };
const good = {
  "uz/site.json": { a: { b: "Salom {name}" } },
  "ru/site.json": { a: { b: "Привет {name}" } },
  "meta/site.json": { "a.b": meta },
};

describe("check-messages: library", () => {
  it("keeps the exports other tests rely on", () => {
    expect(placeholders("{count, plural, one {# sum} other {# sum}} {name}")).toEqual(["count", "name"]);
    const problems = checkNamespace(
      "site",
      { a: { b: "Salom {name}", c: "uzoq matn" } },
      { a: { b: "Привет" } },
      {
        "a.b": { maxLen: 10 },
        "a.c": { maxLen: 5 },
      },
    );
    expect(problems).toContain('site: key "a.c" missing in ru');
    expect(problems.join()).toContain("placeholders differ");
    expect(problems.join()).toContain("maxLen 5");
  });

  it("passes a consistent root", () => {
    expect(checkMessages(makeRoot(good))).toEqual([]);
  });

  it("returns nothing when the messages folder does not exist", () => {
    expect(checkMessages(mkdtempSync(join(tmpdir(), "nivel-empty-")))).toEqual([]);
  });

  it("reports a namespace present in only one language", () => {
    const root = makeRoot({ ...good, "uz/only.json": { a: "x" }, "meta/only.json": {} });
    expect(checkMessages(root)).toEqual(["only: file missing in ru"]);
    const root2 = makeRoot({ ...good, "ru/other.json": { a: "x" }, "meta/other.json": {} });
    expect(checkMessages(root2)).toEqual(["other: file missing in uz"]);
  });

  it("reports a missing meta file", () => {
    const root = makeRoot({ "uz/site.json": { a: "x" }, "ru/site.json": { a: "y" } });
    expect(checkMessages(root)).toEqual(["site: meta/site.json is missing"]);
  });

  it("reports invalid JSON instead of crashing", () => {
    const root = makeRoot({ ...good, "uz/site.json": "{ not json" });
    const problems = checkMessages(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^site: uz\/site\.json is not valid JSON/);
  });

  it("finds differences across several namespaces at once", () => {
    const root = makeRoot({
      ...good,
      "uz/bot.json": { a: "Boshlash" },
      "ru/bot.json": { a: "Начать", extra: "x" },
      "meta/bot.json": { a: { ...meta, maxLen: 3 } },
    });
    const problems = checkMessages(root);
    expect(problems).toContain('bot: key "extra" missing in uz');
    expect(problems).toContain('bot: uz "a" is 8 > maxLen 3');
  });

  it("passes for the real repository catalogs", () => {
    expect(checkMessages(ROOT)).toEqual([]);
  });
});

describe("check-messages: command line", () => {
  const run = (...args) =>
    spawnSync(process.execPath, [join(ROOT, "tools", "check-messages.mjs"), ...args], { encoding: "utf8" });

  it("exits 0 on a clean root and prints the OK line", () => {
    const r = run("--root", makeRoot(good));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check-messages: uz/ru keys, placeholders and limits OK");
  });

  it("exits 1 and lists every problem on a broken root", () => {
    const r = run("--root", makeRoot({ ...good, "uz/site.json": { a: { b: "Salom" } } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("check-messages: 1 problem(s)");
    expect(r.stderr).toContain("placeholders differ");
  });

  it("works on the repository without arguments (the CI step)", () => {
    expect(run().status).toBe(0);
  });
});
