import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMessages } from "../site-messages.ts";

// Every message key that the code of the page asks for must exist in both languages: a missing key shows the visitor the key
// itself (`site.form.consent`) instead of words. The keys are found in the sources: t("a.b"), t.rich("a.b"), t.raw("a.b"),
// t.has("a.b"), within the namespaces that the file opens with getTranslations({ namespace }).
const ROOTS = [join(process.cwd(), "apps/web/app"), join(process.cwd(), "apps/web/src")];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "test-support" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const HOLE = "\u0001";

/** Is there a node at the path? A part with a template hole (`c${i}`) matches any child that fits the fixed text around it. */
function exists(node: unknown, parts: string[]): boolean {
  const [head, ...rest] = parts;
  if (head === undefined) return true;
  if (typeof node !== "object" || node === null) return false;
  const escaped = head.split(HOLE).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`^${escaped.join("[^.]+")}$`);
  return Object.entries(node).some(([k, v]) => pattern.test(k) && exists(v, rest));
}

/** `hero.c${i}.title` becomes the parts `hero`, `c<hole>`, `title`: a dot inside a hole does not split. */
function partsOf(path: string): string[] {
  return path.replace(/\$\{[^}]*\}/g, HOLE).split(".");
}

interface Use {
  file: string;
  key: string;
  namespaces: string[];
}

function usesIn(file: string): Use[] {
  const code = readFileSync(file, "utf8");
  const namespaces = [
    ...code.matchAll(/(?:getTranslations|useTranslations)\(\s*(?:\{[^}]*namespace:\s*)?"([\w.]+)"/g),
  ].map((m) => m[1] as string);
  if (namespaces.length === 0) return [];
  return [...code.matchAll(/\bt(?:\.rich|\.raw|\.has)?\(\s*(["`])([^"`]+)\1/g)].map((m) => ({
    file,
    key: m[2] as string,
    namespaces,
  }));
}

const uses = ROOTS.flatMap((root) => sources(root)).flatMap(usesIn);

describe("message keys used by the page", () => {
  it("are found in the sources (the scan itself works)", () => {
    expect(uses.length).toBeGreaterThan(100);
  });

  for (const locale of ["uz", "ru"] as const) {
    it(`all exist in site.json (${locale})`, () => {
      const messages = loadMessages(locale);
      const missing = uses
        .filter((u) => !u.namespaces.some((ns) => exists(messages, partsOf(`${ns}.${u.key}`))))
        .map((u) => `${u.file.replace(process.cwd(), "")}: ${u.namespaces.join("|")} -> ${u.key}`);
      expect(missing).toEqual([]);
    });
  }
});
