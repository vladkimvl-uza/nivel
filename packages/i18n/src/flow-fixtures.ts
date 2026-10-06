// Test helpers shared by flow and CLI tests: a throw-away repository root with message files and the real glossary seed.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

export interface FixtureNamespace {
  uz: unknown;
  ru: unknown;
  meta: unknown;
}

const glossarySeed = new URL("../../db/seed/glossary/glossary.json", import.meta.url);

export const siteFixture: FixtureNamespace = {
  uz: {
    hero: {
      title: "Kompyuter yigʻamiz",
      count: "{count, plural, one {# ta mahsulot} other {# ta mahsulot}}",
    },
    hello: "Salom, {name}!",
  },
  ru: {
    hero: {
      title: "Соберём компьютер",
      count: "{count, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}",
    },
    hello: "Здравствуйте, {name}!",
  },
  meta: {
    "hero.title": { context: "H1 on the home page", maxLen: 30, status: "draft" },
    "hero.count": { context: "Number of items", maxLen: 60, status: "reviewed", screenshot: "shots/site-hero.png" },
    hello: { context: "Greeting, name is the customer's first name", maxLen: 20, status: "draft" },
  },
};

export const botFixture: FixtureNamespace = {
  uz: { start: "Boshlash" },
  ru: { start: "Начать" },
  meta: { start: { context: "Button /start", maxLen: 10, status: "draft" } },
};

const created: string[] = [];

/** A temporary folder that is removed after the test that asked for it. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function makeRoot(namespaces: Record<string, FixtureNamespace>, { glossary = true } = {}): string {
  const root = tempDir("nivel-i18n-");
  for (const [ns, files] of Object.entries(namespaces)) {
    for (const kind of ["uz", "ru", "meta"] as const) {
      const path = join(root, "packages", "i18n", "messages", kind, `${ns}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(files[kind], null, 2)}\n`);
    }
  }
  if (glossary) {
    const dest = join(root, "packages", "db", "seed", "glossary", "glossary.json");
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(glossarySeed, dest);
  }
  return root;
}

export function readJson(root: string, kind: "uz" | "ru" | "meta", ns: string): unknown {
  return JSON.parse(readFileSync(join(root, "packages", "i18n", "messages", kind, `${ns}.json`), "utf8"));
}

export function readText(root: string, kind: "uz" | "ru" | "meta", ns: string): string {
  return readFileSync(join(root, "packages", "i18n", "messages", kind, `${ns}.json`), "utf8");
}
